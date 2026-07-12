const WEB_SOURCE = "opentune-web";
const HELPER_SOURCE = "opentune-login-helper";

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const message = event.data;
  if (!message || message.source !== WEB_SOURCE || message.type !== "OPENTUNE_AUTH_REQUEST") return;

  const requestId = String(message.requestId || "");
  postToPage({ type: "OPENTUNE_AUTH_STARTED", requestId });

  try {
    chrome.runtime.sendMessage(
      {
        type: "opentune.startAuth",
        requestId,
        apiBase: message.apiBase || window.location.origin,
        // The API is token-protected. The page already holds the token, and the extension has no
        // way to obtain it on its own, so hand it over with the request.
        accessToken: message.accessToken || "",
      },
      (response) => {
        const error = chrome.runtime.lastError;
        if (error || response?.ok === false) {
          postToPage({
            type: "OPENTUNE_AUTH_RESULT",
            requestId,
            ok: false,
            error: error?.message || response?.error || "OpenTune Login Helper failed to start.",
          });
        }
      },
    );
  } catch (error) {
    postToPage({
      type: "OPENTUNE_AUTH_RESULT",
      requestId,
      ok: false,
      error: extensionErrorMessage(error),
    });
  }
});

try {
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "opentune.authResult") return;
    postToPage({
      type: "OPENTUNE_AUTH_RESULT",
      requestId: message.requestId,
      ok: Boolean(message.ok),
      status: message.status,
      error: message.error,
    });
  });
} catch (_error) {
  // The page will show the actionable reload message on the next login attempt.
}

function postToPage(message) {
  window.postMessage({ source: HELPER_SOURCE, ...message }, window.location.origin);
}

function extensionErrorMessage(error) {
  const message = error?.message || "OpenTune Login Helper is unavailable.";
  if (message.toLowerCase().includes("extension context invalidated")) {
    return "OpenTune Login Helper was reloaded. Refresh this OpenTune page, then try login again.";
  }
  return message;
}
