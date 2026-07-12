const LOGIN_URL = "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmusic.youtube.com";
const COOKIE_URLS = ["https://music.youtube.com", "https://www.youtube.com", "https://youtube.com"];
const MUSIC_TAB_MATCHES = ["https://music.youtube.com/*", "https://www.youtube.com/*"];
const AUTH_TIMEOUT_MS = 10 * 60 * 1000;

const BRIDGE_SCRIPT_ID = "opentune-page-bridge";
const STATIC_BRIDGE_MATCHES = [
  "http://localhost:8080/*",
  "http://127.0.0.1:8080/*",
  "http://localhost:5173/*",
  "http://127.0.0.1:5173/*",
];

let pendingAuth = null;

// The bundled content script only matches loopback. When OpenTune Web is opened on a
// LAN address (required for Android pairing, since the phone cannot reach localhost),
// the user clicks the toolbar icon to grant that origin and we inject the bridge there.
chrome.action.onClicked.addListener((tab) => {
  void grantCurrentOrigin(tab);
});

chrome.runtime.onStartup.addListener(() => {
  void syncGrantedBridges();
});

chrome.runtime.onInstalled.addListener(() => {
  void syncGrantedBridges();
});

async function grantCurrentOrigin(tab) {
  if (typeof tab?.id !== "number" || !tab.url) return;

  let origin;
  try {
    const url = new URL(tab.url);
    if (!isPrivateHostname(url.hostname)) throw new Error("not private");
    origin = `${url.origin}/*`;
  } catch (_error) {
    await notifyTab(tab.id, "Open OpenTune Web on this tab first, then click the helper icon.");
    return;
  }

  const granted = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
  if (!granted) return;

  await syncGrantedBridges();
  await chrome.tabs.reload(tab.id);
}

// Content scripts registered dynamically do not survive a service-worker restart unless
// re-registered, so rebuild the set from whatever origins the user has actually granted.
async function syncGrantedBridges() {
  const { origins = [] } = await chrome.permissions.getAll();
  // getAll() also returns the static YouTube/Google host permissions. Injecting the page
  // bridge into those would be both useless and a needless expansion of its reach, so keep
  // only private-network OpenTune origins that the static content_scripts block misses.
  const matches = origins.filter((origin) => {
    if (STATIC_BRIDGE_MATCHES.includes(origin)) return false;
    try {
      return isPrivateHostname(new URL(origin.replace(/\*$/, "")).hostname);
    } catch (_error) {
      return false;
    }
  });

  await chrome.scripting.unregisterContentScripts({ ids: [BRIDGE_SCRIPT_ID] }).catch(() => {});
  if (!matches.length) return;

  await chrome.scripting
    .registerContentScripts([
      {
        id: BRIDGE_SCRIPT_ID,
        js: ["opentune-page.js"],
        matches,
        runAt: "document_start",
      },
    ])
    .catch(() => {});
}

async function notifyTab(tabId, message) {
  await chrome.scripting
    .executeScript({ target: { tabId }, func: (text) => alert(text), args: [message] })
    .catch(() => {});
}

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
    accessToken: String(message.accessToken || ""),
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

    const status = await postAuthSession(pendingAuth.apiBase, session, pendingAuth.accessToken);
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

async function postAuthSession(apiBase, session, accessToken) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (accessToken) headers["X-OpenTune-Token"] = accessToken;

  const response = await fetch(`${apiBase}/api/auth/session`, {
    method: "POST",
    headers,
    body: JSON.stringify(session),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fallback = {
      401: "OpenTune rejected the access token. Reopen OpenTune Web using the link the server printed on startup, then try again.",
      404: "OpenTune API auth endpoint was not found. Make sure the Ktor web API is running on port 8080 with the latest code.",
    }[response.status] || `OpenTune API rejected login (${response.status}).`;
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

// The helper must only ever ship a YouTube Music session to an OpenTune server the
// user actually controls, so origins are restricted to loopback and private-network
// ranges. A public host would mean handing the cookie to a third party.
function isPrivateHostname(hostname) {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;
  if (hostname.endsWith(".local")) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  return false;
}

function resolveApiBase(value) {
  const url = new URL(value);
  if (!isPrivateHostname(url.hostname)) {
    throw new Error("OpenTune Login Helper only connects to OpenTune servers on your own network.");
  }
  // The Vite dev server proxies /api, but the extension fetches the API directly,
  // so hop from the dev port to the Ktor port.
  if (url.port === "5173") return `http://${url.hostname}:8080`;
  return url.origin;
}
