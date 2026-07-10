# OpenTune Login Helper

Companion Chromium extension for the OpenTune web app. It opens the normal Google / YouTube Music login page, reads the YouTube Music cookies through extension permissions, and sends the Android-style session values to the local OpenTune API.

## Install For Development

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Choose Load unpacked.
4. Select this `web-extension/` folder.
5. Run OpenTune web through `./gradlew :webapi:run` or `npm run dev` in `web-app/`.
6. Click Login in OpenTune web, then Login with YouTube Music.

The extension only allows local OpenTune origins: `localhost` and `127.0.0.1` on ports `8080` and `5173`.
