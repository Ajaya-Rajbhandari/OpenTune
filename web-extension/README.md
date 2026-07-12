# OpenTune Login Helper

Companion Chromium extension for the OpenTune web app. It opens the normal Google / YouTube Music login page, reads the YouTube Music cookies through extension permissions, and sends the Android-style session values to the local OpenTune API.

## Store Install

Publish this folder to the Chrome Web Store or Edge Add-ons. After approval, build the web app with the published listing URL:

```bash
VITE_OPENTUNE_HELPER_INSTALL_URL="https://chromewebstore.google.com/detail/..." npm run build
```

The web app opens that URL when a user clicks Login with YouTube Music and the helper is not installed.

## Package For Store

Run this from the repository root:

```bash
cd web-extension
zip -r opentune-login-helper.zip manifest.json background.js opentune-page.js icons README.md PRIVACY.md
```

Upload `opentune-login-helper.zip` to the browser extension store. Do not include generated `.crx` or `.pem` files in git.

## Install For Development

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Choose Load unpacked.
4. Select this `web-extension/` folder.
5. Run OpenTune web through `./gradlew :webapi:run` or `npm run dev` in `web-app/`.
6. Click Login in OpenTune web, then Login with YouTube Music.

The extension only allows local OpenTune origins: `localhost` and `127.0.0.1` on ports `8080` and `5173`.

If the production web app is served from a different origin, add that origin to `host_permissions` and `content_scripts.matches` before publishing.
