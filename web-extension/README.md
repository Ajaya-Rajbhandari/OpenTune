# OpenTune Login Helper

Companion Chromium extension for the OpenTune web app. It opens the normal Google / YouTube Music login page, reads the YouTube Music cookies through extension permissions, and sends the Android-style session values to the local OpenTune API.

## Prefer pairing with the Android app

**This extension is optional, and not published to any store.** Signing in by pairing with the OpenTune Android app is the recommended path: it needs no extension, no store account, and no Google login in the browser, because it reuses the session the phone already has.

In OpenTune Web, open the account panel and choose **Pair with OpenTune Android**. Use this extension only if you want a browser login without installing the Android app.

## Install for development

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select this `web-extension/` folder.
5. Run OpenTune Web through `./gradlew :webapi:run`, or `npm run dev` in `web-app/`.
6. Open OpenTune Web using the `?token=...` link the server prints on startup.
7. Click Login in OpenTune Web, then **Login with YouTube Music**.

## Origins

The helper only talks to OpenTune servers on your own network: loopback, plus the private ranges (`10.x`, `192.168.x`, `172.16–31.x`, `.local`). It refuses public hosts, so the YouTube Music session cannot be sent to a third-party server.

Loopback works with no prompt. On a LAN address — which is what a phone can reach, and therefore what pairing uses — the page bridge is not injected by default. **Click the helper's toolbar icon on that tab** to grant the origin; the helper then registers itself there and reloads the page.

## Access token

The OpenTune API requires an access token. The web app captures it from the startup link and hands it to the helper automatically, so there is nothing to configure. If the helper reports a rejected token, reopen OpenTune Web using the link the server printed.

## Publishing (not currently done)

If you ever do publish it, package from the repository root:

```bash
cd web-extension
zip -r opentune-login-helper.zip manifest.json background.js opentune-page.js icons README.md PRIVACY.md
```

Then build the web app with the listing URL so the install button resolves:

```bash
VITE_OPENTUNE_HELPER_INSTALL_URL="https://chromewebstore.google.com/detail/..." npm run build
```

Do not commit generated `.crx` or `.pem` files; they are gitignored.
