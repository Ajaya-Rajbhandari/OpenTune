# OpenTune Web

Static web/PWA prototype for a future OpenTune web client.

Open `index.html` directly in a browser, or serve the folder with any static file server.
The preferred development path is now the Kotlin web API, which serves this folder and exposes real backend endpoints:

```bash
./gradlew :webapi:run
```

Then open `http://localhost:8080`.

Local requirements:

- JDK 21 for Gradle/Ktor.
- `yt-dlp` on `PATH` for stream URL fallback playback resolution, or set `OPENTUNE_YTDLP_PATH` to the binary path.

The production frontend work now lives in `web-app/`:

```bash
cd web-app
npm install
npm run dev
```

Vite proxies `/api` to `http://127.0.0.1:8080` during development. Build output from `web-app/dist` is preferred by the Kotlin web API when present.

YouTube Music login uses the optional Chromium helper extension in `web-extension/`. Load that folder as an unpacked extension, then use the Login button in the web app. The helper opens the normal Google / YouTube Music login page, reads the needed YouTube cookies through extension permissions, and sends the session to the local `/api/auth/session` endpoint.

The web API persists that session locally at `~/.config/opentune-web/auth-session.json` so it survives API restarts. Set `OPENTUNE_WEB_AUTH_FILE` or `-Dopentune.web.auth.file=/path/to/auth-session.json` to override the file location. Logging out deletes the saved session.

Current scope:

- Desktop-first OpenTune web shell
- Spotify-style left navigation, main content, right now-playing rail, and bottom player
- Home, Search, Explore and Library routes
- Responsive mobile fallback with compact bottom navigation
- Expanded full player with lyrics and queue pages
- API-backed YouTube Music home and search with a demo catalog fallback
- Browser audio playback when `/api/player/{videoId}` resolves a stream URL
- Saved tracks in local storage
- YouTube Music login through the local helper extension, with manual session paste fallback
- Synced demo lyrics
- Network-first PWA service worker for hosted builds

The next production step is adding a backend API proxy for YouTube Music, lyrics, Spotify, and playback URL resolution.
Initial backend routes now exist under `/api`, including health, home, search, search suggestions, and player metadata.
