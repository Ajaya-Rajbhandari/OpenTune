# OpenTune Login Helper Privacy

OpenTune Login Helper runs only when a user starts login from the OpenTune web app.

The extension reads YouTube Music browser session cookies and page session values only to send them to the user's local OpenTune web API. It does not sell data, track browsing, inject ads, or send login data to OpenTune developers.

Data handled by the extension:

- YouTube Music and YouTube cookies needed for authenticated YouTube Music requests.
- YouTube Music Visitor Data, Data Sync ID, and PO token values when available.
- The local OpenTune API origin that requested login.

The extension only connects to local OpenTune web servers on `localhost` or `127.0.0.1` ports `8080` and `5173`.
