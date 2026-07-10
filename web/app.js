const tracks = [
  {
    id: "deep-reflection",
    title: "Nureha no kei (Deep Reflection Remix)",
    artist: "Clean Tears & Hatsune Miku",
    album: "Deep Reflection",
    duration: 437,
    mood: "Relax",
    type: "Song",
    colorA: "#8db7e8",
    colorB: "#32446d",
    colorC: "#dfe8ff",
    lyrics: [
      [0, "静かな夜"],
      [28, "shizuka na yoru"],
      [56, "幾つもの星たちが"],
      [84, "ikutsu mo no hoshi tachi ga"],
      [118, "波に揺られては泳いでいく"],
      [156, "nami ni yura re te ha oyoide iku"],
      [196, "さざ波に浮かぶ舟"],
      [238, "sazanami ni ukabu fune"],
      [286, "二人言葉無く"],
      [334, "ni nin kotoba naku"],
      [384, "優しく月の光は"],
    ],
  },
  {
    id: "signal-bloom",
    title: "Signal Bloom",
    artist: "Tala North",
    album: "Night archive",
    duration: 246,
    mood: "Focus",
    type: "Song",
    colorA: "#ed5564",
    colorB: "#6f2431",
    colorC: "#f6c0c7",
    lyrics: [
      [0, "A red dial wakes in the quiet"],
      [18, "Static folds into a line"],
      [41, "Every window keeps a rhythm"],
      [67, "Every pulse repeats your sign"],
      [96, "Signal bloom, carry me closer"],
      [129, "Through the dark glass of the room"],
      [164, "Signal bloom, keep the night open"],
      [202, "I can hear the morning tune"],
    ],
  },
  {
    id: "monsoon-arcade",
    title: "Monsoon Arcade",
    artist: "Luma Veda",
    album: "Streetlight weather",
    duration: 218,
    mood: "Energize",
    type: "Song",
    colorA: "#51d0bf",
    colorB: "#276d95",
    colorC: "#d7fff7",
    lyrics: [
      [0, "Coins on the counter, rain on the wires"],
      [24, "Neon runs down the lane"],
      [52, "We move like a chorus of tires"],
      [83, "Finding our names in the rain"],
      [118, "Monsoon arcade, light up the water"],
      [151, "Monsoon arcade, keep me awake"],
      [185, "The city is singing in color"],
    ],
  },
  {
    id: "glass-temple",
    title: "Glass Temple",
    artist: "Niko Sable",
    album: "Soft machines",
    duration: 231,
    mood: "Focus",
    type: "Song",
    colorA: "#9da8ff",
    colorB: "#3c3b88",
    colorC: "#edf0ff",
    lyrics: [
      [0, "Steps ring clear in the glass temple"],
      [29, "Hands full of blue electric rain"],
      [59, "I leave the door open behind me"],
      [91, "Nothing is quiet the same"],
      [127, "Hold the note, let it assemble"],
      [164, "All of the pieces we became"],
      [202, "Glass temple, glass temple"],
    ],
  },
  {
    id: "orbit-market",
    title: "Orbit Market",
    artist: "Mira Unit",
    album: "Saturn receipts",
    duration: 207,
    mood: "Workout",
    type: "Song",
    colorA: "#f1a34c",
    colorB: "#a94654",
    colorC: "#fff0c2",
    lyrics: [
      [0, "Buy me a ticket to the outer row"],
      [22, "Where the bright vendors call"],
      [48, "Spinning fruit in a zero-g glow"],
      [78, "Silver dust over all"],
      [109, "Orbit market, count me in"],
      [142, "Pass the moonlight hand to hand"],
      [176, "Orbit market, turn again"],
    ],
  },
  {
    id: "quiet-render",
    title: "Quiet Render",
    artist: "Ada Loop",
    album: "Compile the dawn",
    duration: 289,
    mood: "Commute",
    type: "Song",
    colorA: "#cbbfb7",
    colorB: "#6a5a63",
    colorC: "#fff6ed",
    lyrics: [
      [0, "A small light runs under the floor"],
      [37, "Drawing the shape of a day"],
      [78, "I watch the room become warmer"],
      [113, "I watch the shadows obey"],
      [154, "Quiet render, render me new"],
      [194, "Fold every hour into view"],
      [239, "Quiet render, carry me through"],
    ],
  },
];

const moods = [
  ["Feel good", "#f06292", "#8e244d"],
  ["Energize", "#ffb74d", "#ad5a18"],
  ["Relax", "#81c784", "#28664c"],
  ["Commute", "#64b5f6", "#315d91"],
  ["Focus", "#9575cd", "#443170"],
  ["Workout", "#ef5350", "#8b2025"],
  ["Sleep", "#90a4ae", "#35454f"],
  ["Romance", "#f48fb1", "#8a3156"],
];

const state = {
  route: "home",
  homeFilter: "History",
  libraryFilter: "Library",
  query: "",
  search: {
    query: "",
    status: "idle",
    suggestions: [],
    results: [],
    error: "",
    requestId: 0,
  },
  home: {
    status: "idle",
    sections: [],
    trackIds: [],
    error: "",
  },
  currentTrackId: tracks[0].id,
  queue: tracks.slice(1, 5).map((track) => track.id),
  favorites: new Set([tracks[0].id]),
  downloaded: new Set([tracks[0].id, tracks[3].id]),
  isPlaying: false,
  position: 137,
  loadingTrackId: null,
  playbackError: "",
  shuffle: false,
  repeat: false,
  playerPage: "lyrics",
};

const storageKey = "opentune-web-android-copy-state";
const apiBase = "";
const streamCache = new Map();
const audio = new Audio();
audio.preload = "metadata";
let searchTimer = 0;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const els = {
  device: $(".device-frame"),
  searchInput: $("#searchInput"),
  homeChips: $("#homeChips"),
  libraryChips: $("#libraryChips"),
  quickPicks: $("#quickPicks"),
  speedDial: $("#speedDial"),
  keepListening: $("#keepListening"),
  suggestions: $("#suggestions"),
  searchResults: $("#searchResults"),
  moodGrid: $("#moodGrid"),
  libraryResults: $("#libraryResults"),
  likedCount: $("#likedCount"),
  heroNowCard: $("#heroNowCard"),
  heroArt: $("#heroArt"),
  heroTitle: $("#heroTitle"),
  heroArtist: $("#heroArtist"),
  miniPlayer: $("#miniPlayer"),
  miniDisc: $("#miniDisc"),
  miniTitle: $("#miniTitle"),
  miniArtist: $("#miniArtist"),
  miniPlayButton: $("#miniPlayButton"),
  miniNextButton: $("#miniNextButton"),
  barPrevButton: $("#barPrevButton"),
  barShuffleButton: $("#barShuffleButton"),
  barRepeatButton: $("#barRepeatButton"),
  barProgress: $("#barProgress"),
  barCurrentTime: $("#barCurrentTime"),
  barDuration: $("#barDuration"),
  sideOpenPlayer: $("#sideOpenPlayer"),
  sideArt: $("#sideArt"),
  sideTitle: $("#sideTitle"),
  sideArtist: $("#sideArtist"),
  sideFavoriteButton: $("#sideFavoriteButton"),
  sideQueue: $("#sideQueue"),
  playerSheet: $("#playerSheet"),
  playerArt: $("#playerArt"),
  sheetTitle: $("#sheetTitle"),
  sheetArtist: $("#sheetArtist"),
  sheetFavoriteButton: $("#sheetFavoriteButton"),
  sheetProgress: $("#sheetProgress"),
  sheetCurrentTime: $("#sheetCurrentTime"),
  sheetDuration: $("#sheetDuration"),
  sheetShuffleButton: $("#sheetShuffleButton"),
  sheetRepeatButton: $("#sheetRepeatButton"),
  sheetPlayButton: $("#sheetPlayButton"),
  sheetPrevButton: $("#sheetPrevButton"),
  sheetNextButton: $("#sheetNextButton"),
  lyricsPage: $("#lyricsPage"),
  queuePage: $("#queuePage"),
  toastRegion: $("#toastRegion"),
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

async function apiGet(path, params = {}) {
  const url = new URL(`${apiBase}${path}`, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function colorSetFromId(id) {
  let hash = 0;
  for (const char of id) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  return {
    colorA: `hsl(${hue} 72% 66%)`,
    colorB: `hsl(${(hue + 42) % 360} 54% 34%)`,
    colorC: `hsl(${(hue + 18) % 360} 84% 88%)`,
  };
}

function apiItemToTrack(item) {
  const artists = item.artists?.length
    ? item.artists.map((artist) => artist.name).filter(Boolean).join(", ")
    : item.author?.name || item.type || "YouTube Music";
  return {
    id: item.id,
    title: item.title,
    artist: artists,
    album: item.album?.title || item.songCountText || item.type || "YouTube Music",
    duration: item.duration || 0,
    mood: "Online",
    type: item.type ? item.type[0].toUpperCase() + item.type.slice(1) : "Song",
    thumbnail: item.thumbnail,
    explicit: Boolean(item.explicit),
    source: item.type === "song" ? "youtube" : "youtube-browse",
    playable: item.type === "song",
    lyrics: [],
    ...colorSetFromId(item.id || item.title || "opentune"),
  };
}

function mergeTrack(track) {
  const existing = findTrackById(track.id);
  if (existing) {
    Object.assign(existing, track);
    return existing;
  }
  tracks.push(track);
  return track;
}

function normalizeSearchItems(response) {
  if (Array.isArray(response.items)) return response.items;
  if (Array.isArray(response.summaries)) return response.summaries.flatMap((summary) => summary.items || []);
  return [];
}

function normalizeHomeSections(response) {
  return (response.sections || [])
    .map((section) => {
      const trackIds = (section.items || [])
        .filter((item) => item.id && item.title)
        .map(apiItemToTrack)
        .map((track) => mergeTrack(track).id);
      return {
        title: section.title,
        trackIds,
      };
    })
    .filter((section) => section.trackIds.length);
}

async function loadHome() {
  if (state.home.status === "loading" || state.home.status === "ready") return;
  state.home = { ...state.home, status: "loading", error: "" };
  renderHome();

  try {
    const home = await apiGet("/api/home");
    const sections = normalizeHomeSections(home);
    state.home = {
      status: "ready",
      sections,
      trackIds: sections.flatMap((section) => section.trackIds),
      error: "",
    };
  } catch (error) {
    state.home = {
      ...state.home,
      status: "error",
      error: error.message || "Home feed unavailable",
    };
  }

  renderHome();
}

function trackSubtitle(track) {
  const details = [track.artist, track.duration ? formatTime(track.duration) : track.type || "Song"].filter(Boolean);
  return details.join(" / ");
}

function findTrackById(id) {
  return tracks.find((track) => track.id === id);
}

function trackById(id) {
  return findTrackById(id) || tracks[0];
}

function currentTrack() {
  return trackById(state.currentTrackId);
}

function saveState() {
  localStorage.setItem(
    storageKey,
    JSON.stringify({
      route: state.route,
      homeFilter: state.homeFilter,
      libraryFilter: state.libraryFilter,
      query: state.query,
      currentTrackId: state.currentTrackId,
      queue: state.queue,
      position: state.position,
      shuffle: state.shuffle,
      repeat: state.repeat,
      playerPage: state.playerPage,
      favorites: Array.from(state.favorites),
      downloaded: Array.from(state.downloaded),
    }),
  );
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    if (["home", "search", "explore", "library"].includes(saved.route)) state.route = saved.route;
    if (typeof saved.homeFilter === "string") state.homeFilter = saved.homeFilter;
    if (typeof saved.libraryFilter === "string") state.libraryFilter = saved.libraryFilter;
    if (typeof saved.query === "string") state.query = saved.query;
    if (saved.currentTrackId && findTrackById(saved.currentTrackId)) state.currentTrackId = saved.currentTrackId;
    if (Array.isArray(saved.queue)) state.queue = saved.queue.filter((id) => findTrackById(id));
    if (Array.isArray(saved.favorites)) state.favorites = new Set(saved.favorites.filter((id) => findTrackById(id)));
    if (Array.isArray(saved.downloaded)) state.downloaded = new Set(saved.downloaded.filter((id) => findTrackById(id)));
    if (typeof saved.position === "number") state.position = saved.position;
    state.shuffle = Boolean(saved.shuffle);
    state.repeat = Boolean(saved.repeat);
    if (["lyrics", "queue"].includes(saved.playerPage)) state.playerPage = saved.playerPage;
  } catch {
    localStorage.removeItem(storageKey);
  }
}

function formatTime(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function playIcon() {
  if (state.loadingTrackId === state.currentTrackId) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 10 10h-2a8 8 0 1 1-8-8z" /></svg>';
  }
  return state.isPlaying
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zm6 0h4v14h-4z" /></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>';
}

function setArtVars(element, track) {
  element.style.setProperty("--art-a", track.colorA);
  element.style.setProperty("--art-b", track.colorB);
  element.style.setProperty("--art-c", track.colorC);
  if (track.thumbnail) {
    element.style.setProperty("--art-image", `url("${track.thumbnail.replace(/"/g, "%22")}")`);
  } else {
    element.style.removeProperty("--art-image");
  }
}

function setSheetVars(track) {
  els.playerSheet.style.setProperty("--sheet-a", track.colorA);
  els.playerSheet.style.setProperty("--sheet-b", track.colorB);
}

function renderChips(container, labels, active, onSelect) {
  container.replaceChildren(
    ...labels.map((label) => {
      const button = document.createElement("button");
      button.className = `chip${label === active ? " active" : ""}`;
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", () => onSelect(label));
      return button;
    }),
  );
}

function filteredHomeTracks() {
  if (state.homeFilter === "Liked") return Array.from(state.favorites).map(trackById);
  if (state.homeFilter === "Downloaded") return Array.from(state.downloaded).map(trackById);

  const remoteTracks = state.home.trackIds.map(trackById);
  if (remoteTracks.length && state.homeFilter !== "Stats") return remoteTracks;

  return tracks;
}

function firstPlayableTracks(list) {
  return list.filter((track) => track.playable !== false).slice(0, 12);
}

function renderHome() {
  const homeChipLabels = ["History", "Stats", "Liked", "Downloaded"];
  const activeChip = homeChipLabels.includes(state.homeFilter) ? state.homeFilter : homeChipLabels[0];
  const homeTracks = filteredHomeTracks();
  const playableHomeTracks = firstPlayableTracks(homeTracks);

  renderChips(els.homeChips, homeChipLabels, activeChip, (label) => {
    state.homeFilter = label;
    render();
  });

  if (state.home.status === "loading" && activeChip === "History") {
    renderMessage(els.quickPicks, "Loading YouTube Music home...");
  } else if (state.home.status === "error" && activeChip === "History") {
    els.quickPicks.replaceChildren(...tracks.slice(0, 4).map((track) => quickPickRow(track)));
  } else {
    els.quickPicks.replaceChildren(...homeTracks.slice(0, 4).map((track) => quickPickRow(track)));
  }

  els.speedDial.replaceChildren(
    ...(playableHomeTracks.length ? playableHomeTracks : tracks).slice(0, 6).map((track) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "speed-card";
      setArtVars(card, track);
      card.innerHTML = `<strong>${escapeHtml(track.title)}</strong>`;
      card.addEventListener("click", () => playTrack(track.id));
      return card;
    }),
  );

  const keepListeningTracks = state.home.sections.length
    ? state.home.sections.slice(1, 5).flatMap((section) => section.trackIds.map(trackById))
    : tracks.slice(2).concat(tracks.slice(0, 2));
  els.keepListening.replaceChildren(...keepListeningTracks.slice(0, 12).map((track) => itemCard(track)));
}

function itemCard(track) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "item-card";
  setArtVars(card, track);
  card.innerHTML = `<div class="artwork"></div><strong>${escapeHtml(track.title)}</strong><span>${escapeHtml(track.artist)}</span>`;
  card.addEventListener("click", () => playTrack(track.id));
  return card;
}

function quickPickRow(track) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "quick-pick-row";
  setArtVars(row, track);
  row.innerHTML = `
    <div class="thumb"></div>
    <div class="list-text"><strong>${escapeHtml(track.title)}</strong><span>${escapeHtml(trackSubtitle(track))}</span></div>
    <span class="more-button" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" /></svg></span>
  `;
  row.addEventListener("click", () => playTrack(track.id));
  return row;
}

function queueRemoteSearch(query, delay = 300) {
  window.clearTimeout(searchTimer);
  const trimmed = query.trim();
  const requestId = state.search.requestId + 1;
  if (!trimmed) {
    state.search = { ...state.search, query: "", status: "idle", suggestions: [], results: [], error: "", requestId };
    renderSearch();
    return;
  }
  state.search = { ...state.search, query: trimmed, status: "loading", error: "", requestId };
  renderSearch();
  searchTimer = window.setTimeout(() => loadRemoteSearch(trimmed, requestId), delay);
}

async function loadRemoteSearch(query, requestId) {
  try {
    const [resultsResponse, suggestionsResponse] = await Promise.all([
      apiGet("/api/search", { q: query, filter: "songs" }),
      apiGet("/api/search/suggestions", { q: query }).catch(() => null),
    ]);
    if (requestId !== state.search.requestId) return;

    const resultIds = normalizeSearchItems(resultsResponse)
      .filter((item) => item.id && item.title)
      .map(apiItemToTrack)
      .map((track) => mergeTrack(track).id);
    const suggestions = suggestionsResponse?.queries?.slice(0, 5) || [];

    state.search = {
      ...state.search,
      query,
      status: "ready",
      suggestions,
      results: resultIds,
      error: "",
    };
  } catch (error) {
    if (requestId !== state.search.requestId) return;
    state.search = {
      ...state.search,
      query,
      status: "error",
      suggestions: [],
      results: [],
      error: error.message || "Remote search unavailable",
    };
  }

  renderSearch();
}

function renderSearch() {
  const rawQuery = state.query.trim();
  const query = rawQuery.toLowerCase();
  const localResults = tracks.filter((track) => `${track.title} ${track.artist} ${track.album} ${track.mood}`.toLowerCase().includes(query));
  const remoteResults = state.search.query === rawQuery && state.search.status === "ready"
    ? state.search.results.map(trackById)
    : [];
  const results = rawQuery ? remoteResults.length ? remoteResults : localResults : localResults;
  const suggestions = rawQuery
    ? state.search.suggestions.length
      ? state.search.suggestions
      : results.slice(0, 3).map((track) => track.title)
    : ["hatsune miku", "deep reflection", "focus mix"];

  els.suggestions.replaceChildren(
    ...suggestions.map((suggestion) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "suggestion-row";
      row.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3a9 9 0 1 0 9 9h-2a7 7 0 1 1-2-4.9L15 10h7V3l-2.7 2.7A9 9 0 0 0 13 3z" /></svg>
        <span>${escapeHtml(suggestion)}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 14 5-5 5 5z" /></svg>
      `;
      row.addEventListener("click", () => {
        state.query = suggestion;
        els.searchInput.value = suggestion;
        queueRemoteSearch(suggestion, 0);
      });
      return row;
    }),
  );

  if (rawQuery && state.search.query === rawQuery && state.search.status === "loading") {
    renderMessage(els.searchResults, "Searching YouTube Music...");
    return;
  }

  renderList(
    els.searchResults,
    results,
    rawQuery && state.search.status === "error" ? `Remote search unavailable: ${state.search.error}` : "No results",
  );
}

function renderMoods() {
  els.moodGrid.replaceChildren(
    ...moods.map(([title, a, b]) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "mood-card";
      card.style.setProperty("--art-a", a);
      card.style.setProperty("--art-b", b);
      card.textContent = title;
      card.addEventListener("click", () => {
        state.route = "home";
        state.homeFilter = "History";
        render();
      });
      return card;
    }),
  );
}

function renderLibrary() {
  renderChips(els.libraryChips, ["Library", "Playlists", "Songs", "Albums", "Artists", "Spotify"], state.libraryFilter, (label) => {
    state.libraryFilter = label;
    render();
  });

  els.likedCount.textContent = `${state.favorites.size} ${state.favorites.size === 1 ? "song" : "songs"}`;
  let list = Array.from(state.favorites).map(trackById);
  if (state.libraryFilter === "Songs") list = tracks;
  if (state.libraryFilter === "Albums") list = tracks.slice(0, 4).map((track) => ({ ...track, title: track.album, type: "Album" }));
  if (state.libraryFilter === "Artists") list = tracks.slice(0, 5).map((track) => ({ ...track, title: track.artist, artist: "Artist", type: "Artist" }));
  if (state.libraryFilter === "Spotify") list = tracks.slice(1, 4).map((track) => ({ ...track, artist: `${track.artist} / matched on YouTube` }));
  if (state.libraryFilter === "Playlists") list = tracks.slice(0, 3).map((track, index) => ({ ...track, title: ["Liked songs", "Downloaded", "Quick picks"][index], artist: `${index + 4} songs`, type: "Playlist" }));
  renderList(els.libraryResults, list, "No saved songs");
}

function renderMessage(container, text) {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = text;
  container.replaceChildren(empty);
}

function renderList(container, list, emptyText) {
  if (!list.length) {
    renderMessage(container, emptyText);
    return;
  }

  container.replaceChildren(
    ...list.map((track) => {
      const row = document.createElement("article");
      row.className = `list-row${track.id === state.currentTrackId ? " active" : ""}`;
      setArtVars(row, track);
      row.innerHTML = `
        <div class="thumb ${track.type === "Artist" ? "round" : ""}"></div>
        <div class="list-text"><strong>${escapeHtml(track.title)}</strong><span>${escapeHtml(trackSubtitle(track))}</span></div>
        <button class="more-button" type="button" aria-label="More"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" /></svg></button>
      `;
      row.addEventListener("click", (event) => {
        if (event.target.closest(".more-button")) {
          toggleFavorite(track.id);
          return;
        }
        if (track.playable === false) {
          showToast(`${track.type || "This item"} pages are next`);
          return;
        }
        playTrack(track.id);
      });
      return row;
    }),
  );
}

function renderPlayer() {
  const track = currentTrack();
  const isLoading = state.loadingTrackId === track.id;
  const artistLabel = isLoading ? "Resolving stream..." : state.playbackError ? "Playback unavailable" : track.artist;
  setArtVars(els.miniDisc, track);
  setArtVars(els.heroArt, track);
  setArtVars(els.sideArt, track);
  setArtVars(els.playerArt, track);
  setSheetVars(track);
  const duration = Math.max(0, track.duration || audio.duration || 0);
  const progress = duration ? Math.min(1, state.position / duration) : 0;
  els.miniDisc.style.setProperty("--progress", `${progress * 360}deg`);
  els.heroTitle.textContent = track.title;
  els.heroArtist.textContent = artistLabel;
  els.sideTitle.textContent = track.title;
  els.sideArtist.textContent = artistLabel;
  els.miniTitle.textContent = track.title;
  els.miniArtist.textContent = artistLabel;
  els.sheetTitle.textContent = track.title;
  els.sheetArtist.textContent = artistLabel;
  els.sheetCurrentTime.textContent = formatTime(state.position);
  els.sheetDuration.textContent = duration ? formatTime(duration) : "--:--";
  els.sheetProgress.value = String(Math.round(progress * 1000));
  els.barCurrentTime.textContent = formatTime(state.position);
  els.barDuration.textContent = duration ? formatTime(duration) : "--:--";
  els.barProgress.value = String(Math.round(progress * 1000));
  els.miniPlayButton.innerHTML = playIcon();
  els.sheetPlayButton.innerHTML = playIcon();
  els.miniPlayButton.setAttribute("aria-label", isLoading ? "Resolving stream" : state.isPlaying ? "Pause" : "Play");
  els.sheetPlayButton.setAttribute("aria-label", isLoading ? "Resolving stream" : state.isPlaying ? "Pause" : "Play");
  els.miniPlayButton.disabled = isLoading;
  els.sheetPlayButton.disabled = isLoading;
  els.sheetProgress.disabled = !duration;
  els.barProgress.disabled = !duration;
  els.barShuffleButton.classList.toggle("active", state.shuffle);
  els.barRepeatButton.classList.toggle("active", state.repeat);
  els.sheetShuffleButton.classList.toggle("active", state.shuffle);
  els.sheetRepeatButton.classList.toggle("active", state.repeat);
  els.sheetFavoriteButton.classList.toggle("active", state.favorites.has(track.id));
  els.sideFavoriteButton.classList.toggle("active", state.favorites.has(track.id));
  renderLyrics();
  renderQueue();
  renderSideQueue();
  updateMediaSession(track);
}

function renderLyrics() {
  const track = currentTrack();
  if (!track.lyrics?.length) {
    renderMessage(els.lyricsPage, "Lyrics are not wired to the web API yet");
    return;
  }
  els.lyricsPage.replaceChildren(
    ...track.lyrics.map(([time, text], index) => {
      const next = track.lyrics[index + 1]?.[0] ?? track.duration + 1;
      const line = document.createElement("p");
      line.className = `lyric-line${state.position >= time && state.position < next ? " active" : ""}`;
      line.textContent = text;
      return line;
    }),
  );
}

function renderQueue() {
  const rows = [state.currentTrackId, ...state.queue].map(trackById);
  els.queuePage.replaceChildren(
    ...rows.map((track, index) => {
      const row = document.createElement("article");
      row.className = "queue-row";
      setArtVars(row, track);
      row.innerHTML = `
        <div class="thumb"></div>
        <div class="list-text"><strong>${escapeHtml(track.title)}</strong><span>${escapeHtml(index === 0 ? "Now playing" : track.artist)}</span></div>
        <button class="more-button" type="button" aria-label="More"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" /></svg></button>
      `;
      return row;
    }),
  );
}

function renderSideQueue() {
  const rows = state.queue.slice(0, 5).map(trackById);
  els.sideQueue.replaceChildren(
    ...rows.map((track) => {
      const row = document.createElement("article");
      row.className = "queue-row";
      setArtVars(row, track);
      row.innerHTML = `
        <div class="thumb"></div>
        <div class="list-text"><strong>${escapeHtml(track.title)}</strong><span>${escapeHtml(track.artist)}</span></div>
      `;
      row.addEventListener("click", () => playTrack(track.id));
      return row;
    }),
  );
}

function renderRoutes() {
  $$(".screen-view").forEach((view) => view.classList.toggle("active", view.dataset.view === state.route));
  $$("[data-route]").forEach((element) => element.classList.toggle("active", element.dataset.route === state.route));
}

function renderSheetPages() {
  $$(".sheet-tabs button").forEach((button) => button.classList.toggle("active", button.dataset.playerPage === state.playerPage));
  $$(".sheet-page").forEach((page) => page.classList.remove("active"));
  $(`#${state.playerPage}Page`).classList.add("active");
}

function render() {
  renderRoutes();
  renderHome();
  renderSearch();
  renderMoods();
  renderLibrary();
  renderPlayer();
  renderSheetPages();
  saveState();
}

function isRemotePlayableTrack(track) {
  return track.source === "youtube" && track.playable !== false;
}

function stopAudio() {
  audio.pause();
  audio.removeAttribute("src");
  audio.removeAttribute("data-track-id");
  audio.load();
}

function choosePlayableFormat(formats) {
  const withUrls = formats.filter((format) => format.url);
  return withUrls.find((format) => audio.canPlayType(format.mimeType)) || withUrls[0];
}

async function resolveAudioSource(track) {
  const cached = streamCache.get(track.id);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const player = await apiGet(`/api/player/${encodeURIComponent(track.id)}`);
  if (player.playabilityStatus !== "OK") {
    throw new Error(player.playabilityReason || `Playback unavailable: ${player.playabilityStatus}`);
  }

  track.duration = player.durationSeconds || track.duration;
  track.thumbnail = player.thumbnail || track.thumbnail;
  track.album = track.album || "YouTube Music";

  const selectedFormat = choosePlayableFormat(player.formats || []);
  if (!selectedFormat?.url) throw new Error("No browser-playable stream URL returned yet");

  const expiresAt = Date.now() + Math.max(60, (player.expiresInSeconds || 1800) - 60) * 1000;
  const source = { url: selectedFormat.url, expiresAt };
  streamCache.set(track.id, source);
  return source;
}

async function startAudioPlayback(track) {
  state.loadingTrackId = track.id;
  state.playbackError = "";
  renderPlayer();

  try {
    const source = await resolveAudioSource(track);
    if (state.currentTrackId !== track.id) return;

    if (audio.getAttribute("data-track-id") !== track.id || audio.src !== source.url) {
      audio.src = source.url;
      audio.setAttribute("data-track-id", track.id);
    }
    await audio.play();
    state.isPlaying = true;
  } catch (error) {
    if (state.currentTrackId === track.id) {
      state.isPlaying = false;
      state.playbackError = error.message || "Playback failed";
      stopAudio();
      showToast(state.playbackError);
    }
  } finally {
    if (state.currentTrackId === track.id) {
      state.loadingTrackId = null;
      renderPlayer();
    }
  }
}

function playTrack(trackId) {
  const track = trackById(trackId);
  if (track.playable === false) {
    showToast(`${track.type || "This item"} pages are next`);
    return;
  }

  state.currentTrackId = trackId;
  state.position = 0;
  state.isPlaying = true;
  state.playbackError = "";
  if (!state.queue.includes(trackId)) {
    const queueSource = state.search.results.includes(trackId) ? state.search.results.map(trackById) : tracks;
    state.queue = queueSource
      .filter((candidate) => candidate.id !== trackId && candidate.playable !== false)
      .slice(0, 4)
      .map((candidate) => candidate.id);
  }
  render();

  if (isRemotePlayableTrack(track)) {
    void startAudioPlayback(track);
  } else {
    stopAudio();
  }
}

function togglePlay() {
  const track = currentTrack();
  if (isRemotePlayableTrack(track)) {
    if (audio.getAttribute("data-track-id") === track.id && audio.src) {
      if (audio.paused) {
        audio.play().catch((error) => showToast(error.message || "Playback failed"));
      } else {
        audio.pause();
      }
    } else {
      state.isPlaying = true;
      render();
      void startAudioPlayback(track);
    }
    return;
  }

  state.isPlaying = !state.isPlaying;
  render();
}

function nextTrack() {
  const next = state.shuffle
    ? tracks[Math.floor(Math.random() * tracks.length)].id
    : state.queue.shift() || tracks[(tracks.findIndex((track) => track.id === state.currentTrackId) + 1) % tracks.length].id;
  playTrack(next);
}

function previousTrack() {
  const index = tracks.findIndex((track) => track.id === state.currentTrackId);
  playTrack(tracks[(index - 1 + tracks.length) % tracks.length].id);
}

function toggleFavorite(trackId) {
  if (state.favorites.has(trackId)) {
    state.favorites.delete(trackId);
    showToast("Removed from liked songs");
  } else {
    state.favorites.add(trackId);
    showToast("Added to liked songs");
  }
  render();
}

function openPlayer() {
  els.device.dataset.playerOpen = "true";
  els.playerSheet.setAttribute("aria-hidden", "false");
}

function closePlayer() {
  els.device.dataset.playerOpen = "false";
  els.playerSheet.setAttribute("aria-hidden", "true");
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  els.toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), 2200);
}

function updateMediaSession(track) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album,
    artwork: [{ src: track.thumbnail || "./assets/icon.png", sizes: "512x512", type: "image/png" }],
  });
  navigator.mediaSession.playbackState = state.isPlaying ? "playing" : "paused";
  navigator.mediaSession.setActionHandler("play", togglePlay);
  navigator.mediaSession.setActionHandler("pause", togglePlay);
  navigator.mediaSession.setActionHandler("previoustrack", previousTrack);
  navigator.mediaSession.setActionHandler("nexttrack", nextTrack);
}

function seekToProgress(value) {
  const track = currentTrack();
  const duration = Math.max(0, track.duration || audio.duration || 0);
  if (!duration) return;
  state.position = (Number(value) / 1000) * duration;
  if (isRemotePlayableTrack(track) && audio.src) audio.currentTime = state.position;
  renderPlayer();
  saveState();
}

function bindAudioEvents() {
  audio.addEventListener("timeupdate", () => {
    if (audio.getAttribute("data-track-id") !== state.currentTrackId) return;
    state.position = audio.currentTime || 0;
    renderPlayer();
    saveState();
  });
  audio.addEventListener("durationchange", () => {
    if (audio.getAttribute("data-track-id") !== state.currentTrackId || !Number.isFinite(audio.duration)) return;
    currentTrack().duration = Math.round(audio.duration);
    renderPlayer();
  });
  audio.addEventListener("play", () => {
    if (audio.getAttribute("data-track-id") !== state.currentTrackId) return;
    state.isPlaying = true;
    state.playbackError = "";
    renderPlayer();
  });
  audio.addEventListener("pause", () => {
    if (audio.getAttribute("data-track-id") !== state.currentTrackId) return;
    state.isPlaying = false;
    renderPlayer();
  });
  audio.addEventListener("ended", () => {
    if (state.repeat) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
      return;
    }
    nextTrack();
  });
  audio.addEventListener("error", () => {
    if (audio.getAttribute("data-track-id") !== state.currentTrackId) return;
    state.isPlaying = false;
    state.playbackError = "Playback failed for this stream";
    renderPlayer();
    showToast(state.playbackError);
  });
}

function bindEvents() {
  $$("[data-route]").forEach((element) => {
    element.addEventListener("click", () => {
      state.route = element.dataset.route;
      render();
      if (state.route === "search") window.setTimeout(() => els.searchInput.focus(), 0);
    });
    if (element.tagName !== "BUTTON") {
      element.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        state.route = element.dataset.route;
        render();
        if (state.route === "search") window.setTimeout(() => els.searchInput.focus(), 0);
      });
    }
  });

  els.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value;
    queueRemoteSearch(state.query);
  });
  els.searchInput.addEventListener("focus", () => {
    if (state.route === "search") return;
    state.route = "search";
    render();
    window.setTimeout(() => els.searchInput.focus(), 0);
  });

  els.miniPlayer.addEventListener("click", openPlayer);
  els.heroNowCard.addEventListener("click", openPlayer);
  els.sideOpenPlayer.addEventListener("click", openPlayer);
  els.miniPlayer.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    openPlayer();
  });
  els.miniPlayButton.addEventListener("click", (event) => {
    event.stopPropagation();
    togglePlay();
  });
  els.miniNextButton.addEventListener("click", (event) => {
    event.stopPropagation();
    nextTrack();
  });
  els.barPrevButton.addEventListener("click", previousTrack);
  els.barShuffleButton.addEventListener("click", () => {
    state.shuffle = !state.shuffle;
    render();
  });
  els.barRepeatButton.addEventListener("click", () => {
    state.repeat = !state.repeat;
    render();
  });

  $$("[data-close-player]").forEach((element) => element.addEventListener("click", closePlayer));
  els.sheetPlayButton.addEventListener("click", togglePlay);
  els.sheetNextButton.addEventListener("click", nextTrack);
  els.sheetPrevButton.addEventListener("click", previousTrack);
  els.sheetFavoriteButton.addEventListener("click", () => toggleFavorite(state.currentTrackId));
  els.sideFavoriteButton.addEventListener("click", () => toggleFavorite(state.currentTrackId));
  els.sheetShuffleButton.addEventListener("click", () => {
    state.shuffle = !state.shuffle;
    render();
  });
  els.sheetRepeatButton.addEventListener("click", () => {
    state.repeat = !state.repeat;
    render();
  });
  els.sheetProgress.addEventListener("input", (event) => {
    seekToProgress(event.target.value);
  });
  els.barProgress.addEventListener("input", (event) => {
    seekToProgress(event.target.value);
  });
  $$(".sheet-tabs button").forEach((button) => {
    button.addEventListener("click", () => {
      state.playerPage = button.dataset.playerPage;
      renderSheetPages();
    });
  });
  $("#recognizeButton")?.addEventListener("click", () => showToast("Music recognition needs microphone and Shazam service access"));

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const interactiveTarget = target instanceof Element && target.closest("button, [role='button'], input, textarea, select");
    if (event.code === "Escape") closePlayer();
    if (event.code === "Space" && !interactiveTarget) {
      event.preventDefault();
      togglePlay();
    }
  });
}

function tick() {
  if (isRemotePlayableTrack(currentTrack())) return;
  if (!state.isPlaying) return;
  state.position += 1;
  const duration = currentTrack().duration || 0;
  if (duration && state.position >= duration) {
    if (state.repeat) {
      state.position = 0;
    } else {
      nextTrack();
      return;
    }
  }
  renderPlayer();
  saveState();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (!["http:", "https:"].includes(window.location.protocol)) return;
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

loadState();
els.searchInput.value = state.query;
bindAudioEvents();
bindEvents();
render();
void loadHome();
if (state.query.trim()) queueRemoteSearch(state.query, 0);
registerServiceWorker();
window.setInterval(tick, 1000);
