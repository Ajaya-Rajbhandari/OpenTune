# Store Listing Notes

Suggested name: OpenTune Login Helper

Short description: Connect your browser YouTube Music login to the local OpenTune web app.

Detailed description:

OpenTune Login Helper lets the OpenTune web app complete a normal Google / YouTube Music browser login. When started from OpenTune, the helper opens YouTube Music, reads the browser session values needed by OpenTune, and sends them to the local OpenTune web API.

Permissions rationale:

- `cookies`: Reads YouTube Music and YouTube cookies after the user starts login.
- `tabs`: Opens and monitors the YouTube Music login tab.
- `scripting`: Reads session values exposed on the YouTube Music page.
- YouTube and Google host permissions: Required for the login page and YouTube Music session capture.
- Localhost host permissions: Required to receive login requests from the local OpenTune web app.

Store checklist:

- Confirm `manifest.json` version is bumped for every upload.
- Confirm `host_permissions` and `content_scripts.matches` include the final web app origin.
- Upload a zip containing `manifest.json`, scripts, icons, README, and privacy file.
- Add a public privacy policy URL using `PRIVACY.md` or a hosted copy.
- After approval, set `VITE_OPENTUNE_HELPER_INSTALL_URL` in the web app build.
