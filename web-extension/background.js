const LOGIN_URL = "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmusic.youtube.com";
const COOKIE_URLS = ["https://music.youtube.com", "https://www.youtube.com", "https://youtube.com"];
const MUSIC_TAB_MATCHES = ["https://music.youtube.com/*", "https://www.youtube.com/*"];
const AUTH_TIMEOUT_MS = 10 * 60 * 1000;

let pendingAuth = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "opentune.startAuth") return false;

  startAuth(message, sender)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message || "Unable to start login." }));

  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!pendingAuth || changeInfo.status !== "complete") return;
  if (!tab.url?.startsWith("https://music.youtube.com/")) return;
  void finishPendingAuth();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (pendingAuth?.tabId === tabId) pendingAuth = null;
});

async function startAuth(message, sender) {
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") throw new Error("OpenTune tab not found.");

  pendingAuth = {
    tabId,
    requestId: String(message.requestId || ""),
    apiBase: resolveApiBase(message.apiBase || sender.url),
    expiresAt: Date.now() + AUTH_TIMEOUT_MS,
    inFlight: false,
  };

  const session = await collectSession();
  if (hasSapisid(session.cookie)) {
    await finishPendingAuth(session);
    return;
  }

  await chrome.tabs.create({ url: LOGIN_URL, active: true });
}

async function finishPendingAuth(existingSession) {
  if (!pendingAuth || pendingAuth.inFlight) return;
  if (Date.now() > pendingAuth.expiresAt) {
    notifyResult({ ok: false, error: "YouTube Music login timed out." });
    pendingAuth = null;
    return;
  }

  pendingAuth.inFlight = true;
  try {
    const session = existingSession || await collectSession();
    if (!hasSapisid(session.cookie)) {
      pendingAuth.inFlight = false;
      return;
    }

    const status = await postAuthSession(pendingAuth.apiBase, session);
    notifyResult({ ok: true, status });
    pendingAuth = null;
  } catch (error) {
    notifyResult({ ok: false, error: error.message || "Unable to save YouTube Music session." });
    pendingAuth = null;
  } finally {
    if (pendingAuth) pendingAuth.inFlight = false;
  }
}

async function collectSession() {
  const [cookie, pageAuth] = await Promise.all([collectCookieString(), collectPageAuth()]);
  return {
    cookie,
    visitorData: pageAuth.visitorData || undefined,
    dataSyncId: normalizeDataSyncId(pageAuth.dataSyncId),
    poToken: pageAuth.poToken || undefined,
  };
}

async function collectCookieString() {
  const cookiesByName = new Map();
  for (const url of COOKIE_URLS) {
    const cookies = await chrome.cookies.getAll({ url });
    for (const cookie of cookies) cookiesByName.set(cookie.name, cookie.value);
  }
  return Array.from(cookiesByName.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

async function collectPageAuth() {
  const tabs = await chrome.tabs.query({ url: MUSIC_TAB_MATCHES });
  for (const tab of tabs) {
    if (typeof tab.id !== "number") continue;
    const auth = await readAuthFromTab(tab.id).catch(() => null);
    if (auth?.visitorData || auth?.dataSyncId || auth?.poToken) return auth;
  }
  return {};
}

async function readAuthFromTab(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      const readConfig = (key) => {
        try {
          if (globalThis.ytcfg?.get) return globalThis.ytcfg.get(key) || "";
          if (globalThis.yt?.config_) return globalThis.yt.config_[key] || "";
        } catch (_error) {
          return "";
        }
        return "";
      };

      const readScriptValue = (key) => {
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(`"${escapedKey}"\\s*:\\s*"([^"]+)"`);
        for (const script of document.scripts) {
          const match = script.textContent?.match(pattern);
          if (match) return match[1];
        }
        return "";
      };

      return {
        visitorData: readConfig("VISITOR_DATA") || readScriptValue("VISITOR_DATA"),
        dataSyncId: readConfig("DATASYNC_ID") || readScriptValue("DATASYNC_ID"),
        poToken: readConfig("PO_TOKEN") || readScriptValue("PO_TOKEN"),
      };
    },
  });
  return results?.[0]?.result || {};
}

async function postAuthSession(apiBase, session) {
  const response = await fetch(`${apiBase}/api/auth/session`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(session),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fallback = response.status === 404
      ? "OpenTune API auth endpoint was not found. Make sure the Ktor web API is running on port 8080 with the latest code."
      : `OpenTune API rejected login (${response.status}).`;
    throw new Error(body.error || fallback);
  }
  return body;
}

function notifyResult(result) {
  if (!pendingAuth) return;
  chrome.tabs.sendMessage(pendingAuth.tabId, {
    type: "opentune.authResult",
    requestId: pendingAuth.requestId,
    ...result,
  }).catch(() => {});
}

function hasSapisid(cookie) {
  return /(?:^|;\s*)SAPISID=/.test(cookie || "");
}

function normalizeDataSyncId(value) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.toLowerCase() === "null") return undefined;
  if (!normalized.includes("||")) return normalized;
  return normalized.endsWith("||") ? normalized.split("||")[0] : normalized.split("||").find(Boolean);
}

function resolveApiBase(value) {
  const url = new URL(value);
  if ((url.hostname === "localhost" || url.hostname === "127.0.0.1") && url.port === "8080") return url.origin;
  if ((url.hostname === "localhost" || url.hostname === "127.0.0.1") && url.port === "5173") {
    return `http://${url.hostname}:8080`;
  }
  throw new Error("OpenTune Login Helper only connects to local OpenTune web servers.");
}
