import iconUrl from "../../web/assets/icon.png";

export function mountShell(root: HTMLElement): void {
  root.innerHTML = `
    <div class="device-frame" data-player-open="false">
      <div class="mesh-background" aria-hidden="true"></div>
      <aside class="web-sidebar" aria-label="OpenTune navigation">
        <div class="sidebar-brand"><img src="${iconUrl}" alt="" /><strong>OpenTune</strong></div>
        <nav class="sidebar-nav" aria-label="Primary">
          ${navButton("home", "M3 10.8 12 3l9 7.8V21h-6v-6H9v6H3z", "Home")}
          ${navButton("search", "m20.2 21.5-6.1-6.1a7.4 7.4 0 1 1 1.4-1.4l6.1 6.1zM9.8 15a5.2 5.2 0 1 0 0-10.4 5.2 5.2 0 0 0 0 10.4z", "Search")}
          ${navButton("explore", "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4 6-2.4 5.6L8 16l2.4-5.6z", "Explore")}
          ${navButton("library", "M4 5h3v14H4zm5 0h3v14H9zm6.2 1.1 3-.8 3.6 13.5-3 .8z", "Library")}
        </nav>
        <section class="sidebar-section">
          <div class="sidebar-section-title"><span>Your Library</span></div>
          <div class="library-stack">
            <button class="library-shortcut" id="shortcutLikedSongs" type="button"><span class="shortcut-art liked" id="shortcutLikedArt"></span><span><strong>Liked songs</strong><small id="shortcutLikedCount">Login required</small></span></button>
            <button class="library-shortcut" id="shortcutLibrarySongs" type="button"><span class="shortcut-art downloaded" id="shortcutSongArt"></span><span><strong>Library songs</strong><small id="shortcutSongCount">Login required</small></span></button>
            <button class="library-shortcut" id="shortcutPlaylists" type="button"><span class="shortcut-art mixes" id="shortcutPlaylistArt"></span><span><strong>Playlists</strong><small id="shortcutPlaylistCount">Login required</small></span></button>
          </div>
        </section>
      </aside>
      <main class="app-screen" id="appScreen">
        <header class="web-topbar">
          <div class="history-controls"><button class="icon-button" id="historyBackButton" type="button" aria-label="Back">${svg("m15.4 5.4 1.4 1.4L11.6 12l5.2 5.2-1.4 1.4L8.8 12z")}</button><button class="icon-button" id="historyForwardButton" type="button" aria-label="Forward">${svg("m8.6 18.6-1.4-1.4 5.2-5.2-5.2-5.2 1.4-1.4 6.6 6.6z")}</button></div>
          <label class="search-field web-search-field">${svg("m20.2 21.5-6.1-6.1a7.4 7.4 0 1 1 1.4-1.4l6.1 6.1zM9.8 15a5.2 5.2 0 1 0 0-10.4 5.2 5.2 0 0 0 0 10.4z")}<input id="searchInput" type="search" autocomplete="off" placeholder="What do you want to play?" /></label>
          <button class="account-chip" id="accountChip" type="button" aria-label="Account"><img id="accountAvatar" src="${iconUrl}" data-default-src="${iconUrl}" alt="" /><span id="accountLabel">Login</span></button>
        </header>
        ${screen("home", "homeTitle", `
          <section class="web-hero"><div><p class="overline">OpenTune web app</p><h1 id="homeTitle">Good evening</h1><p class="hero-copy">API-backed home, search, and browser playback.</p></div><button class="hero-now-card" type="button" id="heroNowCard" aria-label="Open player"><span class="hero-art" id="heroArt"></span><span><small>Playing now</small><strong id="heroTitle"></strong><em id="heroArtist"></em></span></button></section>
          <div class="chips-row" id="homeChips" aria-label="Home filters"></div>
          <section class="web-section"><div class="section-title"><h2 id="quickPicksTitle">Quick picks</h2></div><div class="quick-picks-list" id="quickPicks"></div></section>
          <section class="web-section"><div class="section-title"><h2 id="speedDialTitle">Speed dial</h2></div><div class="speed-grid" id="speedDial"></div></section>
          <section class="web-section"><div class="section-title"><h2 id="keepListeningTitle">Keep listening</h2></div><div class="horizontal-list" id="keepListening"></div></section>
        `)}
        ${screen("search", "searchTitle", `<header class="page-heading"><p class="overline">Online</p><h1 id="searchTitle">Search</h1></header><div class="suggestions" id="suggestions"></div><div class="list-group" id="searchResults"></div>`)}
        ${screen("explore", "moodsTitle", `<header class="page-heading"><p class="overline">YouTube Music</p><h1 id="moodsTitle">Explore</h1></header><section class="web-section"><div class="section-title"><h2>New releases</h2></div><div class="horizontal-list" id="exploreNewReleases"></div></section><section class="web-section"><div class="section-title"><h2>Moods & genres</h2></div><div class="mood-grid" id="moodGrid"></div></section>`)}
        ${screen("library", "libraryTitle", `<header class="page-heading"><p class="overline">YouTube Music</p><h1 id="libraryTitle">Library</h1></header><div class="chips-row" id="libraryChips"></div><div class="library-summary"><article class="library-card"><span class="summary-icon favorite" id="librarySummaryArt"></span><strong id="librarySummaryTitle">Liked songs</strong><small id="likedCount">0 songs</small><div class="library-actions"><button class="account-primary" id="libraryPlayButton" type="button">Play</button><button class="text-button" id="libraryShuffleButton" type="button">Shuffle</button></div></article></div><div class="list-group" id="libraryResults"></div>`)}
        ${screen("detail", "detailTitle", `<section class="web-hero"><div><p class="overline" id="detailKind">Collection</p><h1 id="detailTitle">Loading</h1><p class="hero-copy" id="detailSubtitle"></p><div class="detail-actions"><button class="account-primary" id="detailPlayButton" type="button">Play</button><button class="text-button" id="detailShuffleButton" type="button">Shuffle</button></div></div><span class="hero-art" id="detailArt"></span></section><div class="list-group" id="detailResults"></div>`)}
        ${screen("now", "nowTitle", `
          <header class="page-heading"><p class="overline">Player</p><h1 id="nowTitle">Now playing</h1></header>
          <section class="now-page-grid">
            <article class="now-page-card">
              <div class="now-page-topbar"><button class="icon-button" id="nowPageCollapseButton" type="button" aria-label="Collapse player">${svg("m7.4 8.6 4.6 4.6 4.6-4.6L18 10l-6 6-6-6z")}</button><strong>Now playing</strong><span></span></div>
              <div class="now-page-art" id="nowPageArt"></div>
              <div class="now-page-title-row"><div><h2 id="nowPageTitle"></h2><p id="nowPageArtist"></p></div><button class="tonal-button" id="nowPageFavoriteButton" type="button" aria-label="Like">${heartSvg()}</button></div>
              <div class="progress-block"><input id="nowPageProgress" type="range" min="0" max="1000" value="0" /><div><span id="nowPageCurrentTime">0:00</span><span id="nowPageDuration">0:00</span></div></div>
              <div class="sheet-controls"><button class="icon-button player-page-button" id="nowPageLyricsButton" type="button" aria-label="Lyrics" aria-controls="nowPageLyricsOverlay">${lyricsSvg()}</button><button class="icon-button" id="nowPageShuffleButton" type="button" aria-label="Shuffle">${svg("M16 4h5v5h-2V7.7l-3.5 3.5-1.4-1.4L17.6 6H16zM4 7h4.3l9.3 9.3H21v2h-4.3L7.4 9H4zm10.1 7.9 1.4 1.4L19 12.8V11h2v5h-5v-2h1.6zM4 17h4.3l2.2-2.2 1.4 1.4L9.1 19H4z")}</button><button class="large-control" id="nowPagePrevButton" type="button" aria-label="Previous">${svg("M6 5h2v14H6zm3 7 9-7v14z")}</button><button class="main-control" id="nowPagePlayButton" type="button" aria-label="Play">${svg("M8 5v14l11-7z")}</button><button class="large-control" id="nowPageNextButton" type="button" aria-label="Next">${svg("M16 5h2v14h-2zM6 5l9 7-9 7z")}</button><button class="icon-button" id="nowPageRepeatButton" type="button" aria-label="Repeat">${svg("M7 7h9v3l4-4-4-4v3H7a5 5 0 0 0-5 5v1h2v-1a3 3 0 0 1 3-3zm10 10H8v-3l-4 4 4 4v-3h9a5 5 0 0 0 5-5v-1h-2v1a3 3 0 0 1-3 3z")}</button><button class="icon-button player-page-button" id="nowPageQueueButton" type="button" aria-label="Queue">${queueSvg()}</button></div>
            </article>
          </section>
          <div class="now-page-lyrics-overlay" id="nowPageLyricsOverlay" aria-hidden="true"><header><h2>Lyrics</h2><div class="lyrics-header-actions"><button class="icon-button" id="lyricsFullscreenButton" type="button" aria-label="Expand lyrics">${expandSvg()}</button><button class="icon-button" id="nowPageLyricsCloseButton" type="button" aria-label="Close lyrics">${svg("m6 7.4 1.4-1.4 4.6 4.6L16.6 6 18 7.4 13.4 12l4.6 4.6-1.4 1.4-4.6-4.6L7.4 18 6 16.6l4.6-4.6z")}</button></div></header><div class="lyrics-toolbar"><div class="lyrics-mode-group"><button type="button" data-lyrics-mode="focus">Focus</button><button type="button" data-lyrics-mode="full">Full</button><button type="button" data-lyrics-mode="compact">Compact</button></div><div class="lyrics-offset-controls"><button type="button" id="lyricsOffsetBackButton">-0.5s</button><span id="lyricsOffsetLabel">0.0s</span><button type="button" id="lyricsOffsetForwardButton">+0.5s</button></div></div><div class="lyrics-poster" id="lyricsPoster" aria-hidden="true"></div><div class="now-page-scroll" id="nowPageOverlayLyrics"></div><section class="lyrics-music-controls" aria-label="Fullscreen lyrics playback controls"><div class="lyrics-music-progress"><span id="lyricsCurrentTime">0:00</span><input id="lyricsProgress" type="range" min="0" max="1000" value="0" aria-label="Lyrics player progress" /><span id="lyricsDuration">0:00</span></div><div class="lyrics-music-buttons"><button class="icon-button" id="lyricsShuffleButton" type="button" aria-label="Shuffle">${svg("M16 4h5v5h-2V7.7l-3.5 3.5-1.4-1.4L17.6 6H16zM4 7h4.3l9.3 9.3H21v2h-4.3L7.4 9H4zm10.1 7.9 1.4 1.4L19 12.8V11h2v5h-5v-2h1.6zM4 17h4.3l2.2-2.2 1.4 1.4L9.1 19H4z")}</button><button class="large-control" id="lyricsPrevButton" type="button" aria-label="Previous">${svg("M6 5h2v14H6zm3 7 9-7v14z")}</button><button class="main-control" id="lyricsPlayButton" type="button" aria-label="Play">${svg("M8 5v14l11-7z")}</button><button class="large-control" id="lyricsNextButton" type="button" aria-label="Next">${svg("M16 5h2v14h-2zM6 5l9 7-9 7z")}</button><button class="icon-button" id="lyricsRepeatButton" type="button" aria-label="Repeat">${svg("M7 7h9v3l4-4-4-4v3H7a5 5 0 0 0-5 5v1h2v-1a3 3 0 0 1 3-3zm10 10H8v-3l-4 4 4 4v-3h9a5 5 0 0 0 5-5v-1h-2v1a3 3 0 0 1-3 3z")}</button></div></section></div>
        `)}
      </main>
      <aside class="web-now-panel" aria-label="Now playing"><header class="panel-header"><h2>Now playing</h2><button class="icon-button" type="button" aria-label="Open player" id="sideOpenPlayer">${svg("m7.4 8.6 4.6 4.6 4.6-4.6L18 10l-6 6-6-6z")}</button></header><div class="side-art" id="sideArt"></div><div class="side-title-block"><div><h3 id="sideTitle"></h3><p id="sideArtist"></p></div><button class="tonal-button" id="sideFavoriteButton" type="button" aria-label="Like">${heartSvg()}</button></div><section class="side-queue-section"><h3>Up next</h3><div class="side-queue" id="sideQueue"></div></section></aside>
      <aside class="player-sheet" id="playerSheet" aria-label="Expanded player" aria-hidden="true"><div class="sheet-handle" data-close-player></div><header class="player-top"><button class="icon-button" type="button" aria-label="Collapse player" data-close-player>${svg("m7.4 8.6 4.6 4.6 4.6-4.6L18 10l-6 6-6-6z")}</button><strong>Now playing</strong></header><div class="player-art-wrap"><div class="player-art" id="playerArt"></div></div><section class="player-title-block"><div><h2 id="sheetTitle"></h2><p id="sheetArtist"></p></div><button class="tonal-button" id="sheetFavoriteButton" type="button" aria-label="Like">${heartSvg()}</button></section><div class="progress-block"><input id="sheetProgress" type="range" min="0" max="1000" value="0" /><div><span id="sheetCurrentTime">0:00</span><span id="sheetDuration">0:00</span></div></div><div class="sheet-controls"><button class="icon-button player-page-button" type="button" data-player-page="lyrics" aria-label="Lyrics">${lyricsSvg()}</button><button class="icon-button" id="sheetShuffleButton" type="button" aria-label="Shuffle">${svg("M16 4h5v5h-2V7.7l-3.5 3.5-1.4-1.4L17.6 6H16zM4 7h4.3l9.3 9.3H21v2h-4.3L7.4 9H4zm10.1 7.9 1.4 1.4L19 12.8V11h2v5h-5v-2h1.6zM4 17h4.3l2.2-2.2 1.4 1.4L9.1 19H4z")}</button><button class="large-control" id="sheetPrevButton" type="button" aria-label="Previous">${svg("M6 5h2v14H6zm3 7 9-7v14z")}</button><button class="main-control" id="sheetPlayButton" type="button" aria-label="Play">${svg("M8 5v14l11-7z")}</button><button class="large-control" id="sheetNextButton" type="button" aria-label="Next">${svg("M16 5h2v14h-2zM6 5l9 7-9 7z")}</button><button class="icon-button" id="sheetRepeatButton" type="button" aria-label="Repeat">${svg("M7 7h9v3l4-4-4-4v3H7a5 5 0 0 0-5 5v1h2v-1a3 3 0 0 1 3-3zm10 10H8v-3l-4 4 4 4v-3h9a5 5 0 0 0 5-5v-1h-2v1a3 3 0 0 1-3 3z")}</button><button class="icon-button player-page-button" type="button" data-player-page="queue" aria-label="Queue">${queueSvg()}</button></div><div class="sheet-page active" id="lyricsPage"></div><div class="sheet-page" id="queuePage"></div></aside>
      <footer class="bottom-area"><div class="mini-player" id="miniPlayer" role="button" tabindex="0"><div class="mini-disc" id="miniDisc"></div><div class="mini-info"><strong id="miniTitle"></strong><span id="miniArtist"></span></div></div><div class="web-player-center"><div class="bar-controls"><button class="bar-icon" id="barShuffleButton" type="button" aria-label="Shuffle off">${svg("M16 4h5v5h-2V7.7l-3.5 3.5-1.4-1.4L17.6 6H16zM4 7h4.3l9.3 9.3H21v2h-4.3L7.4 9H4zm10.1 7.9 1.4 1.4L19 12.8V11h2v5h-5v-2h1.6zM4 17h4.3l2.2-2.2 1.4 1.4L9.1 19H4z")}</button><button class="bar-icon" id="barPrevButton" type="button" aria-label="Previous">${svg("M6 5h2v14H6zm3 7 9-7v14z")}</button><button class="bar-main" id="miniPlayButton" type="button" aria-label="Play">${svg("M8 5v14l11-7z")}</button><button class="bar-icon" id="miniNextButton" type="button" aria-label="Next">${svg("M16 5h2v14h-2zM6 5l9 7-9 7z")}</button><button class="bar-icon" id="barRepeatButton" type="button" aria-label="Repeat off">${svg("M7 7h9v3l4-4-4-4v3H7a5 5 0 0 0-5 5v1h2v-1a3 3 0 0 1 3-3zm10 10H8v-3l-4 4 4 4v-3h9a5 5 0 0 0 5-5v-1h-2v1a3 3 0 0 1-3 3z")}</button></div><div class="bar-progress"><span id="barCurrentTime">0:00</span><input id="barProgress" type="range" min="0" max="1000" value="0" /><span id="barDuration">0:00</span></div></div><div class="web-player-actions"><button class="bar-icon" id="barQueueButton" type="button" aria-label="Open queue">${svg("M4 6h12v2H4zm0 5h12v2H4zm0 5h8v2H4zm14-1 4 3-4 3z")}</button></div></footer>
      <nav class="floating-toolbar" aria-label="Primary mobile">${toolbarButton("home", "Home")}${toolbarButton("search", "Search")}${toolbarButton("explore", "Explore")}${toolbarButton("library", "Library")}</nav>
      <div class="account-backdrop" id="accountBackdrop" hidden></div>
      <aside class="account-sheet" id="accountSheet" aria-hidden="true" aria-labelledby="accountSheetTitle" hidden>
        <header class="account-sheet-header"><div><p class="overline">YouTube Music</p><h2 id="accountSheetTitle">Login session</h2></div><button class="icon-button" id="accountCloseButton" type="button" aria-label="Close account panel">${svg("m6 7.4 1.4-1.4 4.6 4.6L16.6 6 18 7.4 13.4 12l4.6 4.6-1.4 1.4-4.6-4.6L7.4 18 6 16.6l4.6-4.6z")}</button></header>
        <section class="account-status-card" id="accountStatusCard"><strong id="accountStatusTitle">Not logged in</strong><span id="accountStatusText">Paste the same YouTube Music auth values saved by the Android app.</span></section>
        <section class="account-pairing-card"><div><strong>Pair with OpenTune Android</strong><span id="androidPairingText">Already logged in on Android? Generate a short-lived code and send this login to OpenTune Web.</span></div><button class="account-primary" id="androidPairingButton" type="button">Generate code</button></section>
        <section class="account-pairing-details" id="androidPairingDetails" hidden><div><span>Pairing code</span><strong id="androidPairingCode">--------</strong></div><p id="androidPairingHelp">Open OpenTune on Android, then go to Account > Pair with OpenTune Web.</p><p class="account-pairing-server">Server: <code id="androidPairingServer"></code></p><div class="account-install-actions"><button class="text-button" id="copyAndroidPairingLinkButton" type="button">Copy Android link</button><a class="account-primary" id="androidPairingLink" href="#">Open Android app</a></div></section>
        <section class="account-extension-card"><div><strong>Android-style Google login</strong><span id="extensionLoginText">Use the OpenTune Login Helper extension to open Google login and capture the YouTube Music session automatically.</span></div><button class="account-primary" id="extensionLoginButton" type="button">Login with YouTube Music</button></section>
        <section class="account-install-card" id="extensionInstallCard" hidden>
          <div class="account-install-heading"><strong>Install browser helper</strong><span>OpenTune needs a small browser helper to complete Google login securely. Install it once, then come back and retry.</span></div>
          <p class="account-install-fallback" id="extensionInstallFallback" hidden></p>
          <div class="account-install-actions"><button class="account-primary" id="installExtensionButton" type="button">Install browser helper</button><button class="text-button" id="retryExtensionLoginButton" type="button">Retry login</button></div>
        </section>
        <div class="account-divider" id="accountManualDivider"><span>Manual fallback</span></div>
        <form class="account-form" id="accountForm">
          <div class="account-manual-fields" id="accountManualFields">
            <label><span>InnerTube cookie</span><textarea id="authCookieInput" rows="4" spellcheck="false" placeholder="SAPISID=...; __Secure-..." autocomplete="off"></textarea></label>
            <div class="account-grid-fields"><label><span>Visitor Data</span><input id="authVisitorInput" type="text" spellcheck="false" autocomplete="off" /></label><label><span>Data Sync ID</span><input id="authDataSyncInput" type="text" spellcheck="false" autocomplete="off" /></label></div>
            <label><span>PO token</span><input id="authPoTokenInput" type="text" spellcheck="false" autocomplete="off" /></label>
            <p class="account-help" id="accountHelp">Manual login still works if the helper extension is not installed. Paste a YouTube cookie containing SAPISID plus any Visitor Data, Data Sync ID, or PO token values you have.</p>
          </div>
          <div class="account-actions"><button class="text-button" id="logoutAuthButton" type="button">Log out</button><button class="account-primary" id="saveAuthButton" type="submit">Save manual session</button></div>
        </form>
      </aside>
      <div class="toast-region" id="toastRegion" aria-live="polite"></div>
    </div>
  `;
}

function navButton(route: string, path: string, label: string): string {
  return `<button class="sidebar-link${route === "home" ? " active" : ""}" type="button" data-route="${route}">${svg(path)}<span>${label}</span></button>`;
}

function toolbarButton(route: string, label: string): string {
  return `<button class="toolbar-item${route === "home" ? " active" : ""}" type="button" data-route="${route}"><span>${label}</span></button>`;
}

function screen(route: string, labelId: string, content: string): string {
  return `<section class="screen-view${route === "home" ? " active" : ""}" data-view="${route}" aria-labelledby="${labelId}">${content}</section>`;
}

function svg(path: string): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" /></svg>`;
}

function heartSvg(): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path class="heart-fill" d="M12 21s-7-4.4-9.3-8.8C.8 8.4 3.1 5 6.8 5c2 0 3.4 1 4.2 2.1C11.8 6 13.2 5 15.2 5c3.7 0 6 3.4 4.1 7.2C19 16.6 12 21 12 21z" /><path class="heart-outline" d="M12 19.1c2.4-1.6 5.2-4 6.1-6.2.7-1.4.6-2.8-.1-3.9-.6-1.1-1.6-1.7-2.8-1.7-1.3 0-2.1.6-2.8 1.5L12 9.5l-.8-.7c-.7-.9-1.5-1.5-2.8-1.5-1.2 0-2.2.6-2.8 1.7-.7 1.1-.8 2.5-.1 3.9.9 2.2 3.7 4.6 6.5 6.2zM12 21s-7-4.4-9.3-8.8C.8 8.4 3.1 5 6.8 5c2 0 3.4 1 4.2 2.1C11.8 6 13.2 5 15.2 5c3.7 0 6 3.4 4.1 7.2C19 16.6 12 21 12 21z" /></svg>`;
}

function lyricsSvg(): string {
  return svg("M4 6h16v2H4zm0 5h12v2H4zm0 5h9v2H4z");
}

function queueSvg(): string {
  return svg("M4 6h12v2H4zm0 5h12v2H4zm0 5h8v2H4zm14-1 4 3-4 3z");
}

function expandSvg(): string {
  return svg("M5 5h6v2H8.4l3.3 3.3-1.4 1.4L7 8.4V11H5zm8 0h6v6h-2V8.4l-3.3 3.3-1.4-1.4L15.6 7H13zM10.3 12.3l1.4 1.4L8.4 17H11v2H5v-6h2v2.6zm3.4 0 3.3 3.3V13h2v6h-6v-2h2.6l-3.3-3.3z");
}
