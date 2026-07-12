import { clearAuthSession, getAccessToken, loadAuthPairingStatus, loadAuthStatus, loadBrowseData, loadDetail, loadExploreData, loadHomeData, loadLibraryItems, loadLyrics, loadNextQueue, playerMetadata, saveAuthSession, searchSongs, searchSuggestions, setRemoteLike, startAuthPairing } from "./api";
import { demoTracks, moods } from "./demo";
import { AudioPlayer } from "./player";
import type { AppState, AuthStatusDto, LyricsCalibration, Route, Track } from "./types";

const storageKey = "opentune-web-app-state";

/** Deep enough to step back through a long listening session, bounded so it cannot grow forever. */
const MAX_HISTORY = 200;
const lyricsOffsetStepMs = 500;
const lyricsOffsetLimitMs = 60_000;
const lyricsLeadMs = 300;
const lyricsCalibrationMinGapMs = 20_000;
const lyricsCalibrationMinLyricGapMs = 10_000;
const lyricsCalibrationMinRate = 0.92;
const lyricsCalibrationMaxRate = 1.08;
let tracks: Track[] = demoTracks.map((track) => ({ ...track }));
let searchTimer = 0;
let lyricsAnimationFrame = 0;
let routeBeforeNow: Route = "home";
let lastRoute: Route = "home";
let isHistoryNavigation = false;
let extensionAuthRequestId = "";
let extensionAuthMissingTimer = 0;
let androidPairingPollTimer = 0;
const extensionFolderPath = "web-extension/";
const browserHelperInstallUrl = import.meta.env.VITE_OPENTUNE_HELPER_INSTALL_URL?.trim() || "";
const suppressedFavoriteIds = new Set<string>();
const sidebarLibraryLoading = new Set<string>();
const routeBackStack: Route[] = [];
const routeForwardStack: Route[] = [];

const emptyTrack: Track = {
  id: "",
  title: "Ready to play",
  artist: "Choose music from YouTube Music",
  album: "OpenTune",
  duration: 0,
  mood: "Idle",
  type: "Player",
  colorA: "#8db7e8",
  colorB: "#32446d",
  colorC: "#dfe8ff",
  lyrics: [],
  playable: false,
};

const state: AppState = {
  route: "home",
  homeFilter: "History",
  libraryFilter: "Library",
  query: "",
  search: { query: "", status: "idle", suggestions: [], results: [], error: "", requestId: 0 },
  home: { status: "idle", chips: [], activeChipTitle: "", activeChipParams: "", sections: [], trackIds: [], error: "" },
  detail: { status: "idle", kind: "", itemId: "", title: "", subtitle: "", trackIds: [], error: "" },
  next: { status: "idle", title: "Up next", error: "", requestId: 0 },
  explore: { status: "idle", newReleaseIds: [], moods: [], error: "" },
  library: { status: "idle", activeFilter: "", itemIdsByFilter: {}, error: "" },
  currentTrackId: "",
  queue: [],
  history: [],
  queueSource: [],
  favorites: new Set(),
  downloaded: new Set(),
  isPlaying: false,
  position: 137,
  loadingTrackId: null,
  playbackError: "",
  shuffle: false,
  repeatMode: "off",
  playerPage: "lyrics",
  nowLyricsOpen: false,
  nowQueueOpen: false,
  lyricsFullscreen: false,
  lyricsMode: "focus",
  lyricsOffsetMs: 0,
  lyricsOffsetsMs: {},
  lyricsCalibrations: {},
  auth: {
    status: "idle",
    loggedIn: false,
    hasCookie: false,
    hasVisitorData: false,
    hasDataSyncId: false,
    hasPoToken: false,
    useLoginForBrowse: false,
  },
  accountOpen: false,
  accountSaving: false,
  accountError: "",
  androidPairingPending: false,
  androidPairingCode: "",
  androidPairingExpiresAt: 0,
  extensionLoginPending: false,
  extensionLoginStarted: false,
  extensionInstallVisible: false,
};

const player = new AudioPlayer(
  (patch) => {
    if (patch.trackId && patch.trackId !== state.currentTrackId) return;
    if (patch.position !== undefined) state.position = patch.position;
    if (patch.duration !== undefined) {
      const track = currentTrack();
      track.duration = patch.duration;
      if (track.lyricsStatus === "ready" && track.lyricsMatchDuration !== patch.duration) {
        void loadLyricsForTrack(track.id, true);
      }
    }
    if (patch.isPlaying !== undefined) {
      state.isPlaying = patch.isPlaying;
      if (patch.isPlaying) state.playbackError = "";
    }
    if (patch.isBuffering !== undefined) {
      state.loadingTrackId = patch.isBuffering ? state.currentTrackId : null;
    }
    renderPlayer();
    saveState();
  },
  () => {
    if (state.repeatMode === "one") {
      void player.play(currentTrack());
    } else {
      nextTrack();
    }
  },
  (message, trackId) => {
    if (trackId && trackId !== state.currentTrackId) return;
    state.isPlaying = false;
    state.loadingTrackId = null;
    state.playbackError = message;
    renderPlayer();
    showToast(message);
  },
);

export function bootstrap(): void {
  loadState();
  lastRoute = state.route;
  const searchInput = qs<HTMLInputElement>("#searchInput");
  searchInput.value = state.query;
  bindEvents();
  render();
  void refreshAuthStatus();
  void loadHome();
  void loadExplore();
  if (state.query.trim()) queueRemoteSearch(state.query, 0);
  window.setInterval(tick, 1000);
}

function qs<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

function qsa<T extends Element>(selector: string): T[] {
  return Array.from(document.querySelectorAll<T>(selector));
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char] || char);
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function mergeTrack(track: Track): Track {
  const existing = tracks.find((candidate) => candidate.id === track.id);
  if (existing) {
    Object.assign(existing, track);
    return existing;
  }
  tracks.push(track);
  return track;
}

function trackById(id: string): Track {
  if (!id) return emptyTrack;
  return tracks.find((track) => track.id === id) || emptyTrack;
}

function currentTrack(): Track {
  return trackById(state.currentTrackId);
}

function isDemoTrack(track: Track): boolean {
  return track.source === "demo";
}

function isEmptyTrack(track: Track): boolean {
  return track.id === "";
}

function knownTracks(): Track[] {
  const realTracks = tracks.filter((track) => !isDemoTrack(track));
  return realTracks.length ? realTracks : tracks;
}

function playableKnownTracks(): Track[] {
  return knownTracks().filter((track) => track.playable !== false);
}

function favoriteTrackIds(): string[] {
  const knownIds = new Set(knownTracks().map((track) => track.id));
  return Array.from(state.favorites).filter((id) => knownIds.has(id));
}

function saveState(): void {
  localStorage.setItem(storageKey, JSON.stringify({
    route: state.route,
    homeFilter: state.homeFilter,
    libraryFilter: state.libraryFilter,
    query: state.query,
    currentTrackId: state.currentTrackId,
    queue: state.queue,
    history: state.history,
    queueSource: state.queueSource,
    position: state.position,
    shuffle: state.shuffle,
    repeatMode: state.repeatMode,
    playerPage: state.playerPage,
    lyricsMode: state.lyricsMode,
    lyricsOffsetMs: state.lyricsOffsetMs,
    lyricsOffsetsMs: state.lyricsOffsetsMs,
    lyricsCalibrations: state.lyricsCalibrations,
    favorites: Array.from(state.favorites),
    downloaded: Array.from(state.downloaded),
  }));
}

function loadState(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    if (["home", "search", "explore", "library", "detail", "now"].includes(saved.route)) state.route = saved.route === "detail" ? "home" : saved.route;
    if (typeof saved.homeFilter === "string") state.homeFilter = saved.homeFilter === "Stats" || saved.homeFilter === "Downloaded" ? "History" : saved.homeFilter;
    if (typeof saved.libraryFilter === "string") state.libraryFilter = saved.libraryFilter;
    if (typeof saved.query === "string") state.query = saved.query;
    if (saved.currentTrackId && tracks.some((track) => track.id === saved.currentTrackId && track.source !== "demo")) state.currentTrackId = saved.currentTrackId;
    if (Array.isArray(saved.queue)) state.queue = saved.queue.filter((id: string) => tracks.some((track) => track.id === id));
    if (Array.isArray(saved.history)) state.history = saved.history.filter((id: string) => tracks.some((track) => track.id === id));
    if (Array.isArray(saved.queueSource)) state.queueSource = saved.queueSource.filter((id: string) => tracks.some((track) => track.id === id));
    if (Array.isArray(saved.favorites)) state.favorites = new Set(saved.favorites.filter((id: string) => tracks.some((track) => track.id === id)));
    if (Array.isArray(saved.downloaded)) state.downloaded = new Set(saved.downloaded.filter((id: string) => tracks.some((track) => track.id === id)));
    if (typeof saved.position === "number") state.position = saved.position;
    state.shuffle = Boolean(saved.shuffle);
    state.repeatMode = saved.repeatMode === "one" || saved.repeatMode === "all" ? saved.repeatMode : saved.repeat ? "all" : "off";
    if (["lyrics", "queue"].includes(saved.playerPage)) state.playerPage = saved.playerPage;
    if (["focus", "full", "compact"].includes(saved.lyricsMode)) state.lyricsMode = saved.lyricsMode;
    if (typeof saved.lyricsOffsetMs === "number") {
      state.lyricsOffsetMs = clampLyricsOffsetMs(saved.lyricsOffsetMs);
    } else if (typeof saved.lyricsOffset === "number") {
      state.lyricsOffsetMs = clampLyricsOffsetMs(Math.round(saved.lyricsOffset * 1000));
    }
    if (saved.lyricsOffsetsMs && typeof saved.lyricsOffsetsMs === "object" && !Array.isArray(saved.lyricsOffsetsMs)) {
      state.lyricsOffsetsMs = Object.fromEntries(
        Object.entries(saved.lyricsOffsetsMs)
          .filter(([trackId, offsetMs]) => trackId && typeof offsetMs === "number")
          .map(([trackId, offsetMs]) => [trackId, clampLyricsOffsetMs(offsetMs as number)]),
      );
    }
    if (saved.lyricsCalibrations && typeof saved.lyricsCalibrations === "object" && !Array.isArray(saved.lyricsCalibrations)) {
      state.lyricsCalibrations = Object.fromEntries(
        Object.entries(saved.lyricsCalibrations)
          .map(([trackId, calibration]) => [trackId, parseLyricsCalibration(calibration)] as const)
          .filter((entry): entry is [string, LyricsCalibration] => Boolean(entry[0] && entry[1])),
      );
    }
  } catch {
    localStorage.removeItem(storageKey);
  }
}

function parseLyricsCalibration(value: unknown): LyricsCalibration | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<LyricsCalibration>;
  if (
    typeof candidate.anchorPlaybackMs !== "number" ||
    typeof candidate.anchorLyricMs !== "number" ||
    typeof candidate.rate !== "number" ||
    typeof candidate.lastPlaybackMs !== "number" ||
    typeof candidate.lastLyricMs !== "number"
  ) return null;

  const rate = clampLyricsRate(candidate.rate);
  return {
    anchorPlaybackMs: Math.max(0, Math.round(candidate.anchorPlaybackMs)),
    anchorLyricMs: Math.max(0, Math.round(candidate.anchorLyricMs)),
    rate,
    lastPlaybackMs: Math.max(0, Math.round(candidate.lastPlaybackMs)),
    lastLyricMs: Math.max(0, Math.round(candidate.lastLyricMs)),
  };
}

function clampLyricsOffsetMs(offsetMs: number): number {
  return Math.max(-lyricsOffsetLimitMs, Math.min(lyricsOffsetLimitMs, Math.round(offsetMs)));
}

function clampLyricsRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  return Math.max(lyricsCalibrationMinRate, Math.min(lyricsCalibrationMaxRate, rate));
}

function syncedLyricsPosition(): number {
  return Math.max(0, calibratedLyricsPositionSeconds(playbackPositionSeconds()));
}

function playbackPositionSeconds(): number {
  const track = currentTrack();
  if (player.isRemoteTrack(track) && Number.isFinite(player.audio.currentTime)) return player.audio.currentTime || 0;
  return state.position;
}

function formatLyricsOffset(offsetMs: number): string {
  const seconds = offsetMs / 1000;
  return `${seconds > 0 ? "+" : ""}${seconds.toFixed(1)}s`;
}

function formatLyricsRate(rate: number): string {
  const percent = Math.round((rate - 1) * 1000) / 10;
  if (Math.abs(percent) < 0.1) return "normal speed";
  return `${percent > 0 ? "+" : ""}${percent.toFixed(1)}%`;
}

function formatLyricsSyncLabel(): string {
  const calibration = currentLyricsCalibration();
  if (!calibration) return formatLyricsOffset(currentLyricsOffsetMs());
  const rateLabel = formatLyricsRate(calibration.rate);
  return rateLabel === "normal speed" ? formatLyricsOffset(currentLyricsOffsetMs()) : `${formatLyricsOffset(currentLyricsOffsetMs())} ${rateLabel}`;
}

function currentLyricsOffsetMs(): number {
  const calibration = currentLyricsCalibration();
  if (calibration) return Math.round(calibratedLyricsPositionSeconds(playbackPositionSeconds()) * 1000 - playbackPositionSeconds() * 1000 - lyricsLeadMs);

  const trackId = state.currentTrackId;
  if (trackId && Object.prototype.hasOwnProperty.call(state.lyricsOffsetsMs, trackId)) {
    return clampLyricsOffsetMs(state.lyricsOffsetsMs[trackId]);
  }
  return clampLyricsOffsetMs(state.lyricsOffsetMs);
}

function setCurrentLyricsOffsetMs(offsetMs: number): void {
  const clamped = clampLyricsOffsetMs(offsetMs);
  if (state.currentTrackId) {
    delete state.lyricsCalibrations[state.currentTrackId];
    state.lyricsOffsetsMs = { ...state.lyricsOffsetsMs, [state.currentTrackId]: clamped };
  } else {
    state.lyricsOffsetMs = clamped;
  }
}

function setCurrentLyricsCalibration(playbackMs: number, lyricMs: number, rate = 1): void {
  if (!state.currentTrackId) {
    setCurrentLyricsOffsetMs(lyricMs - playbackMs);
    return;
  }

  const calibration: LyricsCalibration = {
    anchorPlaybackMs: Math.max(0, Math.round(playbackMs)),
    anchorLyricMs: Math.max(0, Math.round(lyricMs)),
    rate: clampLyricsRate(rate),
    lastPlaybackMs: Math.max(0, Math.round(playbackMs)),
    lastLyricMs: Math.max(0, Math.round(lyricMs)),
  };
  state.lyricsCalibrations = { ...state.lyricsCalibrations, [state.currentTrackId]: calibration };
  state.lyricsOffsetsMs = { ...state.lyricsOffsetsMs, [state.currentTrackId]: clampLyricsOffsetMs(lyricMs - playbackMs) };
}

function shiftCurrentLyricsSync(deltaMs: number): void {
  const calibration = currentLyricsCalibration();
  if (!calibration || !state.currentTrackId) {
    setCurrentLyricsOffsetMs(currentLyricsOffsetMs() + deltaMs);
    return;
  }

  const nextOffsetMs = clampLyricsOffsetMs(currentLyricsOffsetMs() + deltaMs);
  state.lyricsCalibrations = {
    ...state.lyricsCalibrations,
    [state.currentTrackId]: {
      ...calibration,
      anchorLyricMs: Math.max(0, calibration.anchorLyricMs + deltaMs),
      lastLyricMs: Math.max(0, calibration.lastLyricMs + deltaMs),
    },
  };
  state.lyricsOffsetsMs = { ...state.lyricsOffsetsMs, [state.currentTrackId]: nextOffsetMs };
}

function resetCurrentLyricsSync(): void {
  if (state.currentTrackId) {
    delete state.lyricsCalibrations[state.currentTrackId];
  }
  setCurrentLyricsOffsetMs(0);
}

function currentLyricsCalibration(): LyricsCalibration | null {
  const trackId = state.currentTrackId;
  if (!trackId) return null;
  return state.lyricsCalibrations[trackId] || null;
}

function calibratedLyricsPositionSeconds(playbackSeconds: number): number {
  const calibration = currentLyricsCalibration();
  const playbackMs = playbackSeconds * 1000 + lyricsLeadMs;
  if (!calibration) return playbackSeconds + (fallbackLyricsOffsetMs() + lyricsLeadMs) / 1000;
  return (calibration.anchorLyricMs + (playbackMs - calibration.anchorPlaybackMs) * calibration.rate) / 1000;
}

function fallbackLyricsOffsetMs(): number {
  const trackId = state.currentTrackId;
  if (trackId && Object.prototype.hasOwnProperty.call(state.lyricsOffsetsMs, trackId)) {
    return clampLyricsOffsetMs(state.lyricsOffsetsMs[trackId]);
  }
  return clampLyricsOffsetMs(state.lyricsOffsetMs);
}

function lyricsTimingMode(track: Track): "unsynced" | "line" | "calibrated" {
  if (track.lyricsSynced === false || !track.lyrics.length) return "unsynced";
  const calibration = currentLyricsCalibration();
  return calibration && hasLyricsDriftCalibration(calibration) ? "calibrated" : "line";
}

function hasLyricsDriftCalibration(calibration: LyricsCalibration): boolean {
  return Math.abs(calibration.lastPlaybackMs - calibration.anchorPlaybackMs) >= lyricsCalibrationMinGapMs;
}

async function loadHome(): Promise<void> {
  if (state.home.status === "loading" || state.home.status === "ready") return;
  state.home = { ...state.home, status: "loading", error: "" };
  renderHome();
  try {
    const home = await loadHomeData(mergeTrack, state.home.activeChipParams);
    state.home = {
      ...state.home,
      status: "ready",
      chips: home.chips.length ? home.chips : state.home.chips,
      sections: home.sections,
      trackIds: home.sections.flatMap((section) => section.trackIds),
      error: "",
    };
    migratePlayerToRealData();
  } catch (error) {
    state.home = { ...state.home, status: "error", error: error instanceof Error ? error.message : "Home feed unavailable" };
  }
  renderHome();
}

async function loadExplore(): Promise<void> {
  if (state.explore.status === "loading" || state.explore.status === "ready") return;
  state.explore = { ...state.explore, status: "loading", error: "" };
  renderMoods();
  try {
    const explore = await loadExploreData(mergeTrack);
    state.explore = {
      status: "ready",
      newReleaseIds: explore.newReleaseIds,
      moods: explore.moods || [],
      error: "",
    };
  } catch (error) {
    state.explore = { ...state.explore, status: "error", error: error instanceof Error ? error.message : "Explore unavailable" };
  }
  renderMoods();
}

async function loadLibraryForFilter(filter = libraryApiFilter(), force = false): Promise<void> {
  if (!state.auth.loggedIn) return;
  if (state.library.status === "loading" && state.library.activeFilter === filter) return;
  if (!force && state.library.itemIdsByFilter[filter]) return;

  state.library = { ...state.library, status: "loading", activeFilter: filter, error: "" };
  renderLibrary();
  try {
    const ids = await loadLibraryItems(filter, mergeTrack);
    const itemIdsByFilter = { ...state.library.itemIdsByFilter, [filter]: ids };
    if (filter === "songs") {
      const mergedFavorites = new Set(state.favorites);
      ids.forEach((id) => {
        if (!suppressedFavoriteIds.has(id)) mergedFavorites.add(id);
      });
      state.favorites = mergedFavorites;
      itemIdsByFilter.songs = favoriteTrackIds();
    }

    state.library = {
      ...state.library,
      status: "ready",
      activeFilter: filter,
      itemIdsByFilter,
      error: "",
    };
  } catch (error) {
    state.library = { ...state.library, status: "error", activeFilter: filter, error: error instanceof Error ? error.message : "Library unavailable" };
  }
  renderLibrary();
  renderRightRail();
  saveState();
}

async function preloadSidebarLibrary(): Promise<void> {
  if (!state.auth.loggedIn) return;
  for (const filter of ["songs", "saved_songs", "playlists"]) {
    if (state.library.itemIdsByFilter[filter] || sidebarLibraryLoading.has(filter)) continue;
    sidebarLibraryLoading.add(filter);
    renderSidebarLibrary();
    try {
      const ids = await loadLibraryItems(filter, mergeTrack);
      const itemIdsByFilter = { ...state.library.itemIdsByFilter, [filter]: ids };
      if (filter === "songs") {
        const mergedFavorites = new Set(state.favorites);
        ids.forEach((id) => {
          if (!suppressedFavoriteIds.has(id)) mergedFavorites.add(id);
        });
        state.favorites = mergedFavorites;
        itemIdsByFilter.songs = favoriteTrackIds();
      }
      state.library = { ...state.library, itemIdsByFilter };
    } catch {
      // Keep the main library view responsible for surfacing detailed errors.
    } finally {
      sidebarLibraryLoading.delete(filter);
      renderSidebarLibrary();
    }
  }
  saveState();
}

function libraryApiFilter(): string {
  switch (state.libraryFilter) {
    case "Songs":
      return "songs";
    case "Saved songs":
      return "saved_songs";
    case "Albums":
      return "albums";
    case "Playlists":
      return "playlists";
    case "Artists":
      return "artists";
    default:
      return "library";
  }
}

function migratePlayerToRealData(): void {
  if (!isDemoTrack(currentTrack())) return;

  player.stop();
  state.currentTrackId = "";
  state.queue = [];
  state.history = [];
  state.queueSource = [];
  state.position = 0;
  state.isPlaying = false;
  state.loadingTrackId = null;
  state.playbackError = "";
}

function setArtVars(element: HTMLElement, track: Track): void {
  element.style.setProperty("--art-a", track.colorA);
  element.style.setProperty("--art-b", track.colorB);
  element.style.setProperty("--art-c", track.colorC);
  if (track.thumbnail) element.style.setProperty("--art-image", `url("${track.thumbnail.replace(/"/g, "%22")}")`);
  else element.style.removeProperty("--art-image");
}

function setArtworkFromIds(selector: string, ids: string[], fallbackClass: string): void {
  const element = qs<HTMLElement>(selector);
  const track = ids.map(trackById).find((candidate) => candidate.thumbnail);
  element.className = fallbackClass;
  if (track) {
    setArtVars(element, track);
  } else {
    element.style.removeProperty("--art-image");
    element.style.removeProperty("--art-a");
    element.style.removeProperty("--art-b");
    element.style.removeProperty("--art-c");
  }
}

function render(): void {
  renderRoutes();
  renderAccount();
  renderSidebarLibrary();
  renderHome();
  renderSearch();
  renderMoods();
  renderLibrary();
  renderDetail();
  renderPlayer();
  renderSheetPages();
  saveState();
}

function renderSidebarLibrary(): void {
  const likedCount = state.library.itemIdsByFilter.songs?.length ?? favoriteTrackIds().length;
  const savedCount = state.library.itemIdsByFilter.saved_songs?.length;
  const playlistCount = state.library.itemIdsByFilter.playlists?.length;
  setArtworkFromIds("#shortcutLikedArt", state.library.itemIdsByFilter.songs || favoriteTrackIds(), "shortcut-art liked");
  setArtworkFromIds("#shortcutSongArt", state.library.itemIdsByFilter.saved_songs || [], "shortcut-art downloaded");
  setArtworkFromIds("#shortcutPlaylistArt", state.library.itemIdsByFilter.playlists || [], "shortcut-art mixes");
  setText("#shortcutLikedCount", state.auth.loggedIn ? (likedCount ? `${likedCount} liked` : sidebarLibraryLoading.has("songs") || state.library.status === "loading" && state.library.activeFilter === "songs" ? "Loading liked songs" : "0 liked") : "Login required");
  setText("#shortcutSongCount", state.auth.loggedIn ? (savedCount !== undefined ? `${savedCount} songs` : sidebarLibraryLoading.has("saved_songs") ? "Loading saved songs" : "0 songs") : "Login required");
  setText("#shortcutPlaylistCount", state.auth.loggedIn ? (playlistCount !== undefined ? `${playlistCount} playlists` : sidebarLibraryLoading.has("playlists") ? "Loading playlists" : "0 playlists") : "Login required");
}

function renderRoutes(): void {
  recordRouteHistory();
  qsa<HTMLElement>(".screen-view").forEach((view) => view.classList.toggle("active", view.dataset.view === state.route));
  qsa<HTMLElement>("[data-route]").forEach((element) => element.classList.toggle("active", element.dataset.route === state.route));
  qs<HTMLElement>(".device-frame").dataset.route = state.route;
  qs<HTMLElement>(".web-now-panel").dataset.mode = state.route === "now" ? state.nowQueueOpen ? "queue" : "library" : "player";
  qs<HTMLButtonElement>("#historyBackButton").disabled = routeBackStack.length === 0;
  qs<HTMLButtonElement>("#historyForwardButton").disabled = routeForwardStack.length === 0;
}

function recordRouteHistory(): void {
  if (state.route === lastRoute) return;
  if (isHistoryNavigation) {
    isHistoryNavigation = false;
    lastRoute = state.route;
    return;
  }

  routeBackStack.push(lastRoute);
  routeForwardStack.length = 0;
  lastRoute = state.route;
}

function navigateHistory(direction: "back" | "forward"): void {
  const source = direction === "back" ? routeBackStack : routeForwardStack;
  const target = source.pop();
  if (!target) return;

  if (direction === "back") routeForwardStack.push(state.route);
  else routeBackStack.push(state.route);
  isHistoryNavigation = true;
  state.route = target;
  if (state.route !== "now") {
    state.nowLyricsOpen = false;
    state.nowQueueOpen = false;
    state.lyricsFullscreen = false;
  }
  render();
}

function renderAccount(): void {
  const account = state.auth.account;
  const avatar = qs<HTMLImageElement>("#accountAvatar");
  const fallbackAvatar = avatar.dataset.defaultSrc || avatar.src;
  avatar.src = account?.thumbnailUrl || fallbackAvatar;
  qs<HTMLElement>("#accountChip").classList.toggle("active", state.auth.loggedIn);
  setText("#accountLabel", state.auth.status === "loading" ? "Checking" : state.auth.loggedIn ? account?.name || "Logged in" : "Login");

  const sheet = qs<HTMLElement>("#accountSheet");
  const backdrop = qs<HTMLElement>("#accountBackdrop");
  sheet.hidden = !state.accountOpen;
  backdrop.hidden = !state.accountOpen;
  sheet.setAttribute("aria-hidden", String(!state.accountOpen));
  if (!state.accountOpen) return;

  const statusCard = qs<HTMLElement>("#accountStatusCard");
  const authError = state.accountError || state.auth.error || "";
  statusCard.classList.toggle("logged-in", state.auth.loggedIn);
  statusCard.classList.toggle("error", Boolean(authError));
  qs<HTMLElement>("#accountManualDivider").hidden = state.auth.loggedIn;
  qs<HTMLElement>("#accountManualFields").hidden = state.auth.loggedIn;
  qs<HTMLButtonElement>("#saveAuthButton").hidden = state.auth.loggedIn;
  qs<HTMLButtonElement>("#androidPairingButton").disabled = state.androidPairingPending || state.accountSaving;
  qs<HTMLElement>("#androidPairingDetails").hidden = !state.androidPairingCode;
  qs<HTMLAnchorElement>("#androidPairingLink").href = androidPairingDeepLink();
  setText("#androidPairingButton", state.androidPairingPending ? "Waiting..." : state.androidPairingCode ? "New code" : "Generate code");
  setText("#androidPairingCode", state.androidPairingCode || "--------");
  setText("#androidPairingServer", window.location.origin);
  setText("#androidPairingText", androidPairingText());
  setText("#androidPairingHelp", androidPairingHelpText());
  if (state.accountSaving) {
    setText("#accountStatusTitle", "Saving session...");
    setText("#accountStatusText", "Applying these values to the local OpenTune API.");
  } else if (state.auth.status === "loading") {
    setText("#accountStatusTitle", "Checking session...");
    setText("#accountStatusText", "Reading the current local API auth state.");
  } else if (state.auth.loggedIn) {
    setText("#accountStatusTitle", account?.name || "Logged in");
    setText("#accountStatusText", [account?.email || account?.channelHandle, authError || "Login is active for browse and playback requests."].filter(Boolean).join(" / "));
  } else {
    setText("#accountStatusTitle", authError ? "Login failed" : "Not logged in");
    setText("#accountStatusText", authError || "Paste the same YouTube Music auth values saved by the Android app.");
  }

  ["#authCookieInput", "#authVisitorInput", "#authDataSyncInput", "#authPoTokenInput", "#saveAuthButton", "#logoutAuthButton"].forEach((selector) => {
    qs<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>(selector).disabled = state.accountSaving;
  });
  qs<HTMLButtonElement>("#logoutAuthButton").disabled = state.accountSaving || !state.auth.loggedIn;
  qs<HTMLButtonElement>("#extensionLoginButton").disabled = state.extensionLoginPending || state.accountSaving;
  qs<HTMLButtonElement>("#installExtensionButton").hidden = !browserHelperInstallUrl;
  qs<HTMLButtonElement>("#installExtensionButton").disabled = state.accountSaving;
  qs<HTMLButtonElement>("#retryExtensionLoginButton").disabled = state.extensionLoginPending || state.accountSaving;
  qs<HTMLElement>("#extensionInstallFallback").hidden = Boolean(browserHelperInstallUrl);
  qs<HTMLElement>("#extensionInstallCard").hidden = !state.extensionInstallVisible;
  setText("#saveAuthButton", state.accountSaving ? "Saving..." : "Save manual session");
  setText("#extensionLoginButton", extensionLoginButtonText());
  setText("#extensionLoginText", extensionLoginText());
  setText("#extensionInstallFallback", `Developer build: set VITE_OPENTUNE_HELPER_INSTALL_URL to the store URL, or load ${extensionFolderPath} manually.`);
}

function androidPairingText(): string {
  if (state.androidPairingPending) return "Waiting for Android to send your saved YouTube Music login.";
  if (state.androidPairingCode) return "Open OpenTune Android and enter this pairing code before it expires.";
  return "Already logged in on Android? Generate a short-lived code and send this login to OpenTune Web.";
}

function androidPairingHelpText(): string {
  if (isLoopbackOrigin()) return "This page is using localhost. For phone pairing, open OpenTune Web with your computer's LAN IP, then generate a new code.";
  return "Open OpenTune on Android, then go to Account > Pair with OpenTune Web. You can also open the Android link below.";
}

function isLoopbackOrigin(): boolean {
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}

function androidPairingDeepLink(): string {
  const params = new URLSearchParams({
    server: window.location.origin,
    code: state.androidPairingCode,
  });
  return `opentune://web-pair?${params}`;
}

function extensionLoginButtonText(): string {
  if (state.extensionLoginPending) return "Waiting for login...";
  if (state.extensionInstallVisible) return browserHelperInstallUrl ? "Install browser helper" : "Retry after installing";
  return state.auth.loggedIn ? "Refresh YouTube Music login" : "Login with YouTube Music";
}

// The helper only auto-injects on loopback. On a LAN origin it is installed but idle until
// the user grants this origin from the toolbar icon, so "install it" would be wrong advice.
function helperUnreachableMessage(): string {
  if (!isLoopbackOrigin()) {
    return "If the helper is already installed, click its toolbar icon to allow it on this address, then retry login.";
  }
  return "Install the OpenTune Login Helper extension, then retry login.";
}

function extensionLoginText(): string {
  if (state.extensionLoginPending && state.extensionLoginStarted) return "Complete Google login in the YouTube Music tab. OpenTune will update when the session is captured.";
  if (state.extensionLoginPending) return "Looking for the OpenTune Login Helper extension...";
  if (state.extensionInstallVisible) return helperUnreachableMessage();
  if (state.auth.loggedIn) return "Your YouTube Music session is already saved. Use this only if playback or browse starts failing.";
  return "Optional. Needs the OpenTune Login Helper extension. If you already use OpenTune on Android, pairing above is simpler.";
}

async function refreshAuthStatus(): Promise<void> {
  state.auth = { ...state.auth, status: "loading" };
  renderAccount();
  try {
    applyAuthStatus(await loadAuthStatus());
    if (state.auth.loggedIn) void preloadSidebarLibrary();
  } catch (error) {
    state.auth = { ...state.auth, status: "error", error: error instanceof Error ? error.message : "Unable to check login" };
  }
  renderAccount();
}

function applyAuthStatus(auth: AuthStatusDto): void {
  state.auth = { ...auth, status: "ready" };
  state.accountError = auth.error || "";
}

function openAccountSheet(): void {
  state.accountOpen = true;
  state.accountError = "";
  state.extensionInstallVisible = false;
  renderAccount();
  void refreshAuthStatus();
}

function closeAccountSheet(): void {
  state.accountOpen = false;
  state.accountError = "";
  state.extensionInstallVisible = false;
  clearAndroidPairing();
  renderAccount();
}

async function startAndroidPairing(): Promise<void> {
  state.accountError = "";
  state.androidPairingPending = true;
  state.androidPairingCode = "";
  state.androidPairingExpiresAt = 0;
  window.clearTimeout(androidPairingPollTimer);
  renderAccount();

  try {
    const pairing = await startAuthPairing();
    state.androidPairingCode = pairing.code;
    state.androidPairingExpiresAt = pairing.expiresAt;
    showToast("Pairing code ready");
    pollAndroidPairing();
  } catch (error) {
    state.androidPairingPending = false;
    state.accountError = error instanceof Error ? error.message : "Could not start Android pairing";
  }
  renderAccount();
}

async function pollAndroidPairing(): Promise<void> {
  if (!state.androidPairingPending || !state.androidPairingCode) return;

  try {
    const status = await loadAuthPairingStatus(state.androidPairingCode);
    if (status.state === "paired" && status.auth) {
      clearAndroidPairing();
      applyAuthStatus(status.auth);
      clearDemoPlayback();
      clearAccountInputs();
      resetHomeFeed();
      void loadHome();
      if (state.auth.loggedIn) void preloadSidebarLibrary();
      showToast("Android login paired");
      if (state.auth.loggedIn) state.accountOpen = false;
      renderAccount();
      return;
    }

    if (status.state === "expired" || status.state === "missing" || Date.now() > state.androidPairingExpiresAt) {
      clearAndroidPairing();
      state.accountError = "Android pairing code expired. Generate a new code.";
      renderAccount();
      return;
    }
  } catch (error) {
    clearAndroidPairing();
    state.accountError = error instanceof Error ? error.message : "Android pairing failed";
    renderAccount();
    return;
  }

  androidPairingPollTimer = window.setTimeout(() => void pollAndroidPairing(), 2000);
}

function clearAndroidPairing(): void {
  window.clearTimeout(androidPairingPollTimer);
  state.androidPairingPending = false;
  state.androidPairingCode = "";
  state.androidPairingExpiresAt = 0;
}

async function copyAndroidPairingLink(): Promise<void> {
  if (!state.androidPairingCode) return;
  try {
    await navigator.clipboard.writeText(androidPairingDeepLink());
    showToast("Android pairing link copied");
  } catch {
    showToast("Could not copy pairing link");
  }
}

function requestExtensionLogin(): void {
  state.accountError = "";
  state.extensionLoginPending = true;
  state.extensionLoginStarted = false;
  state.extensionInstallVisible = false;
  extensionAuthRequestId = createRequestId();
  window.clearTimeout(extensionAuthMissingTimer);
  extensionAuthMissingTimer = window.setTimeout(() => {
    if (!state.extensionLoginPending || state.extensionLoginStarted) return;
    state.extensionLoginPending = false;
    state.extensionInstallVisible = true;
    state.accountError = helperUnreachableMessage();
    renderAccount();
  }, 1800);
  renderAccount();

  window.postMessage(
    {
      source: "opentune-web",
      type: "OPENTUNE_AUTH_REQUEST",
      requestId: extensionAuthRequestId,
      apiBase: window.location.origin,
      // The helper posts the captured session straight to the API, which is token-protected.
      accessToken: getAccessToken(),
    },
    window.location.origin,
  );
}

function handleExtensionLoginClick(): void {
  if (state.extensionInstallVisible && browserHelperInstallUrl) {
    installBrowserHelper();
    return;
  }
  requestExtensionLogin();
}

function handleExtensionMessage(event: MessageEvent): void {
  if (event.source !== window) return;
  const message = event.data;
  if (!message || message.source !== "opentune-login-helper") return;
  if (message.requestId !== extensionAuthRequestId) return;

  if (message.type === "OPENTUNE_AUTH_STARTED") {
    window.clearTimeout(extensionAuthMissingTimer);
    extensionAuthMissingTimer = window.setTimeout(() => {
      if (!state.extensionLoginPending) return;
      state.extensionLoginPending = false;
      state.extensionLoginStarted = false;
      state.accountError = "YouTube Music login timed out. Try again when the login tab is ready.";
      renderAccount();
    }, 10 * 60 * 1000);
    state.extensionLoginStarted = true;
    state.extensionLoginPending = true;
    state.extensionInstallVisible = false;
    state.accountError = "";
    renderAccount();
    return;
  }

  if (message.type !== "OPENTUNE_AUTH_RESULT") return;
  window.clearTimeout(extensionAuthMissingTimer);
  state.extensionLoginPending = false;
  state.extensionLoginStarted = false;
  state.extensionInstallVisible = false;

  if (message.ok && message.status) {
    applyAuthStatus(message.status as AuthStatusDto);
    clearDemoPlayback();
    clearAccountInputs();
    resetHomeFeed();
    void loadHome();
    if (state.auth.loggedIn) void preloadSidebarLibrary();
    showToast(state.auth.error ? "Session saved, account info unavailable" : "YouTube Music login saved");
    if (state.auth.loggedIn) state.accountOpen = false;
  } else {
    state.accountError = message.error || "OpenTune Login Helper could not complete login.";
  }

  renderAccount();
}

function installBrowserHelper(): void {
  if (!browserHelperInstallUrl) {
    state.accountError = "Browser helper install page is not configured for this build.";
    state.extensionInstallVisible = true;
    renderAccount();
    return;
  }

  window.open(browserHelperInstallUrl, "_blank", "noopener,noreferrer");
  showToast("Install the helper, then return and retry login");
}

function createRequestId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function saveAccountSession(): Promise<void> {
  const cookie = qs<HTMLTextAreaElement>("#authCookieInput").value.trim();
  if (!cookie) {
    if (state.auth.loggedIn) {
      showToast("YouTube Music session is already saved");
      closeAccountSheet();
      return;
    }
    state.accountError = "Paste a YouTube Music cookie containing SAPISID.";
    renderAccount();
    return;
  }

  state.accountSaving = true;
  state.accountError = "";
  renderAccount();
  try {
    applyAuthStatus(await saveAuthSession({
      cookie,
      visitorData: qs<HTMLInputElement>("#authVisitorInput").value.trim() || undefined,
      dataSyncId: qs<HTMLInputElement>("#authDataSyncInput").value.trim() || undefined,
      poToken: qs<HTMLInputElement>("#authPoTokenInput").value.trim() || undefined,
    }));
    clearDemoPlayback();
    if (state.auth.loggedIn && !state.auth.error) clearAccountInputs();
    resetHomeFeed();
    void loadHome();
    if (state.auth.loggedIn) void preloadSidebarLibrary();
    showToast(state.auth.error ? "Session saved, account info unavailable" : state.auth.loggedIn ? "YouTube Music login saved" : "Session saved");
  } catch (error) {
    state.accountError = error instanceof Error ? error.message : "Unable to save login";
  } finally {
    state.accountSaving = false;
    renderAccount();
  }
}

async function logoutAccountSession(): Promise<void> {
  state.accountSaving = true;
  state.accountError = "";
  renderAccount();
  try {
    applyAuthStatus(await clearAuthSession());
    clearAccountInputs();
    suppressedFavoriteIds.clear();
    sidebarLibraryLoading.clear();
    state.library = { status: "idle", activeFilter: "", itemIdsByFilter: {}, error: "" };
    resetHomeFeed();
    void loadHome();
    showToast("Logged out of YouTube Music");
  } catch (error) {
    state.accountError = error instanceof Error ? error.message : "Unable to log out";
  } finally {
    state.accountSaving = false;
    renderAccount();
  }
}

function resetHomeFeed(): void {
  state.home = { ...state.home, status: "idle", sections: [], trackIds: [], error: "" };
}

function clearAccountInputs(): void {
  ["#authCookieInput", "#authVisitorInput", "#authDataSyncInput", "#authPoTokenInput"].forEach((selector) => {
    qs<HTMLInputElement | HTMLTextAreaElement>(selector).value = "";
  });
}

function clearDemoPlayback(): void {
  if (!isDemoTrack(currentTrack())) return;
  player.stop();
  state.currentTrackId = "";
  state.queue = [];
  state.history = [];
  state.queueSource = [];
  state.position = 0;
  state.isPlaying = false;
  state.loadingTrackId = null;
  state.playbackError = "";
}

function toggleNowPage(): void {
  if (state.route === "now") {
    collapseNowPage();
  } else {
    openNowPage();
  }
}

function openNowPage(): void {
  delete qs<HTMLElement>(".device-frame").dataset.nowClosing;
  if (state.route !== "now") routeBeforeNow = state.route;
  state.nowLyricsOpen = false;
  state.nowQueueOpen = false;
  state.lyricsFullscreen = false;
  state.route = "now";
  render();
}

function collapseNowPage(): void {
  state.nowLyricsOpen = false;
  qs<HTMLElement>(".device-frame").dataset.nowClosing = "true";
  window.setTimeout(() => {
    state.route = routeBeforeNow === "now" ? "home" : routeBeforeNow;
    delete qs<HTMLElement>(".device-frame").dataset.nowClosing;
    render();
  }, 240);
}

function renderChips(container: HTMLElement, labels: string[], active: string, onSelect: (label: string) => void): void {
  container.replaceChildren(...labels.map((label) => {
    const button = document.createElement("button");
    button.className = `chip${label === active ? " active" : ""}`;
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => onSelect(label));
    return button;
  }));
}

function homeTracks(): Track[] {
  if (state.homeFilter === "Liked") return favoriteTrackIds().map(trackById);
  const remoteTracks = state.home.trackIds.map(trackById);
  return remoteTracks.length ? remoteTracks : knownTracks();
}

function renderHome(): void {
  renderHomeChips();

  if (state.homeFilter === "Liked") {
    renderLocalHomeFilter();
    return;
  }

  if (state.home.status === "loading" && !state.home.sections.length) {
    setHomeSectionTitles("YouTube Music", "Recommendations", "More for you");
    renderMessage(qs("#quickPicks"), "Loading your YouTube Music home...");
    qs("#speedDial").replaceChildren();
    qs("#keepListening").replaceChildren();
    return;
  }

  if (state.home.status === "error" && !state.home.sections.length) {
    setHomeSectionTitles("YouTube Music", "Recommendations", "More for you");
    renderMessage(qs("#quickPicks"), `YouTube Music home unavailable: ${state.home.error}`);
    qs("#speedDial").replaceChildren();
    qs("#keepListening").replaceChildren();
    return;
  }

  if (state.home.sections.length) {
    renderRemoteHomeSections();
    return;
  }

  renderDemoHomeFallback();
}

function renderHomeChips(): void {
  const youtubeChips = [{ title: "For you", params: "" }, ...state.home.chips];
  const labels = [...youtubeChips.map((chip) => chip.title), "Liked"];
  const active = state.homeFilter === "Liked"
    ? state.homeFilter
    : state.home.activeChipTitle || "For you";

  renderChips(qs("#homeChips"), labels, active, (label) => {
    if (label === "Liked") {
      state.homeFilter = label;
      void loadLibraryForFilter("songs");
      render();
      return;
    }

    const chip = youtubeChips.find((candidate) => candidate.title === label);
    state.homeFilter = "History";
    state.home.activeChipTitle = label === "For you" ? "" : label;
    state.home.activeChipParams = chip?.params || "";
    state.home.status = "idle";
    state.home.sections = [];
    state.home.trackIds = [];
    void loadHome();
  });
}

function renderLocalHomeFilter(): void {
  const items = homeTracks();
  const title = "Liked songs";
  setHomeSectionTitles(title, "Speed dial", "Keep listening");
  renderList(qs("#quickPicks"), items, state.library.status === "loading" && state.library.activeFilter === "songs" ? "Loading liked songs..." : "No liked songs");
  qs("#speedDial").replaceChildren(...items.filter((track) => track.playable !== false).slice(0, 6).map(speedCard));
  qs("#keepListening").replaceChildren(...items.slice(6, 18).map(itemCard));
}

function renderRemoteHomeSections(): void {
  const [primary, secondary] = state.home.sections;
  const primaryTracks = sectionTracks(primary);
  const secondaryTracks = sectionTracks(secondary);
  const remainingTracks = state.home.sections.slice(2).flatMap(sectionTracks);
  const keepTracks = remainingTracks.length
    ? remainingTracks
    : [
      ...primaryTracks.slice(8),
      ...secondaryTracks.slice(6),
    ];

  setHomeSectionTitles(
    primary?.title || "YouTube Music",
    secondary?.title || "More from YouTube Music",
    state.home.sections[2]?.title || "Keep listening",
  );
  qs("#quickPicks").replaceChildren(...primaryTracks.slice(0, 8).map(quickPickRow));
  qs("#speedDial").replaceChildren(...(secondaryTracks.length ? secondaryTracks : primaryTracks).filter((track) => track.playable !== false).slice(0, 8).map(speedCard));
  qs("#keepListening").replaceChildren(...keepTracks.slice(0, 16).map(itemCard));
}

function renderDemoHomeFallback(): void {
  const items = homeTracks();
  setHomeSectionTitles("Quick picks", "Speed dial", "Keep listening");
  qs("#quickPicks").replaceChildren(...items.slice(0, 4).map(quickPickRow));
  qs("#speedDial").replaceChildren(...items.filter((track) => track.playable !== false).slice(0, 6).map(speedCard));
  qs("#keepListening").replaceChildren(...knownTracks().slice(2).concat(knownTracks().slice(0, 2)).slice(0, 12).map(itemCard));
}

function sectionTracks(section: { trackIds: string[] } | undefined): Track[] {
  return section?.trackIds.map(trackById) || [];
}

function setHomeSectionTitles(primary: string, secondary: string, tertiary: string): void {
  setText("#quickPicksTitle", primary);
  setText("#speedDialTitle", secondary);
  setText("#keepListeningTitle", tertiary);
}

function quickPickRow(track: Track): HTMLElement {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "quick-pick-row";
  setArtVars(row, track);
  row.innerHTML = `<div class="thumb"></div><div class="list-text"><strong>${escapeHtml(track.title)}</strong><span>${escapeHtml(trackSubtitle(track))}</span></div><span class="more-button" aria-hidden="true">•••</span>`;
  row.addEventListener("click", () => openTrack(track.id));
  return row;
}

function speedCard(track: Track): HTMLElement {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "speed-card";
  setArtVars(card, track);
  card.innerHTML = `<strong>${escapeHtml(track.title)}</strong>`;
  card.addEventListener("click", () => openTrack(track.id));
  return card;
}

function itemCard(track: Track): HTMLElement {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "item-card";
  setArtVars(card, track);
  card.innerHTML = `<div class="artwork"></div><strong>${escapeHtml(track.title)}</strong><span>${escapeHtml(track.artist)}</span>`;
  card.addEventListener("click", () => openTrack(track.id));
  return card;
}

function trackSubtitle(track: Track): string {
  if (track.type === "Artist") return track.album && track.album !== "Artist" ? track.album : "Artist";
  return [track.artist, track.duration ? formatTime(track.duration) : track.type].filter(Boolean).join(" / ");
}

function queueRemoteSearch(query: string, delay = 300): void {
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
  searchTimer = window.setTimeout(() => void loadRemoteSearch(trimmed, requestId), delay);
}

async function loadRemoteSearch(query: string, requestId: number): Promise<void> {
  try {
    const [results, suggestions] = await Promise.all([
      searchSongs(query, mergeTrack),
      searchSuggestions(query).catch(() => []),
    ]);
    if (requestId !== state.search.requestId) return;
    state.search = { ...state.search, query, status: "ready", suggestions, results, error: "" };
  } catch (error) {
    if (requestId !== state.search.requestId) return;
    state.search = { ...state.search, query, status: "error", suggestions: [], results: [], error: error instanceof Error ? error.message : "Remote search unavailable" };
  }
  renderSearch();
}

function renderSearch(): void {
  const rawQuery = state.query.trim();
  const searchableTracks = knownTracks();
  const localResults = searchableTracks.filter((track) => `${track.title} ${track.artist} ${track.album} ${track.mood}`.toLowerCase().includes(rawQuery.toLowerCase()));
  const remoteResults = state.search.query === rawQuery && state.search.status === "ready" ? state.search.results.map(trackById) : [];
  const results = rawQuery ? (remoteResults.length ? remoteResults : localResults) : localResults;
  const defaultSuggestions = searchableTracks
    .flatMap((track) => [track.title, track.artist])
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .slice(0, 5);
  const suggestions = rawQuery
    ? (state.search.suggestions.length ? state.search.suggestions : results.slice(0, 5).map((track) => track.title))
    : defaultSuggestions;

  qs("#suggestions").replaceChildren(...suggestions.map((suggestion) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "suggestion-row";
    row.innerHTML = `<span aria-hidden="true"></span><span>${escapeHtml(suggestion)}</span><span aria-hidden="true"></span>`;
    row.addEventListener("click", () => {
      state.query = suggestion;
      qs<HTMLInputElement>("#searchInput").value = suggestion;
      queueRemoteSearch(suggestion, 0);
    });
    return row;
  }));

  if (rawQuery && state.search.query === rawQuery && state.search.status === "loading") renderMessage(qs("#searchResults"), "Searching YouTube Music...");
  else renderList(qs("#searchResults"), results, rawQuery && state.search.status === "error" ? `Remote search unavailable: ${state.search.error}` : "No results");
}

function renderMoods(): void {
  if (state.explore.status === "loading" && !state.explore.moods.length) {
    renderMessage(qs("#exploreNewReleases"), "Loading YouTube Music explore...");
    renderMessage(qs("#moodGrid"), "Loading moods and genres...");
    return;
  }

  if (state.explore.status === "error" && !state.explore.moods.length) {
    renderMessage(qs("#exploreNewReleases"), `Explore unavailable: ${state.explore.error}`);
    renderMessage(qs("#moodGrid"), "Unable to load moods and genres");
    return;
  }

  qs("#exploreNewReleases").replaceChildren(...state.explore.newReleaseIds.map(trackById).slice(0, 16).map(itemCard));

  const chips = state.explore.moods.length
    ? state.explore.moods.map((mood, index) => {
      const fallback = moods[index % moods.length];
      return {
        title: mood.title,
        colorA: mood.color || fallback[1],
        colorB: fallback[2],
        browseId: mood.endpoint?.browseId || "",
        params: mood.endpoint?.params || "",
      };
    })
    : moods.map(([title, colorA, colorB]) => ({ title, colorA, colorB, browseId: "", params: "" }));

  qs("#moodGrid").replaceChildren(...chips.map((chip) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "mood-card";
    card.style.setProperty("--art-a", chip.colorA);
    card.style.setProperty("--art-b", chip.colorB);
    card.textContent = chip.title;
    card.addEventListener("click", () => {
      if (chip.browseId) void openBrowseMood(chip.title, chip.browseId, chip.params);
      else {
        state.route = "home";
        state.homeFilter = "History";
        render();
      }
    });
    return card;
  }));
}

async function openBrowseMood(title: string, browseId: string, params: string): Promise<void> {
  state.route = "detail";
  state.detail = {
    status: "loading",
    kind: "browse",
    itemId: "",
    title,
    subtitle: "YouTube Music",
    trackIds: [],
    error: "",
  };
  render();

  try {
    const browse = await loadBrowseData(browseId, params, mergeTrack);
    state.detail = {
      ...state.detail,
      status: "ready",
      title: browse.title || title,
      subtitle: "YouTube Music",
      thumbnail: browse.thumbnail,
      trackIds: browse.trackIds,
      error: "",
    };
  } catch (error) {
    state.detail = {
      ...state.detail,
      status: "error",
      error: error instanceof Error ? error.message : "Unable to load this genre",
    };
  }
  render();
}

function renderLibrary(): void {
  renderChips(qs("#libraryChips"), ["Library", "Songs", "Saved songs", "Albums", "Playlists", "Artists"], state.libraryFilter, (label) => {
    state.libraryFilter = label;
    render();
    void loadLibraryForFilter(libraryApiFilter());
  });
  const likedCount = state.library.itemIdsByFilter.songs?.length ?? favoriteTrackIds().length;
  const currentItems = libraryItems();
  const playableItems = currentItems.filter((track) => track.playable !== false);
  setArtworkFromIds("#librarySummaryArt", currentItems.map((track) => track.id), "summary-icon favorite");
  setText("#librarySummaryTitle", librarySummaryTitle());
  qs("#likedCount").textContent = state.libraryFilter === "Songs"
    ? `${likedCount} ${likedCount === 1 ? "song" : "songs"}`
    : `${currentItems.length} ${currentItems.length === 1 ? "item" : "items"}`;
  ["#libraryPlayButton", "#libraryShuffleButton"].forEach((selector) => {
    qs<HTMLButtonElement>(selector).disabled = playableItems.length === 0;
  });

  const filter = libraryApiFilter();
  if (state.auth.loggedIn && !state.library.itemIdsByFilter[filter] && state.library.status !== "loading") {
    void loadLibraryForFilter(filter);
  }

  if (!state.auth.loggedIn) {
    renderMessage(qs("#libraryResults"), "Login to load your YouTube Music library");
    return;
  }

  if (state.library.status === "loading" && state.library.activeFilter === filter && !state.library.itemIdsByFilter[filter]) {
    renderMessage(qs("#libraryResults"), "Loading your YouTube Music library...");
    return;
  }

  if (state.library.status === "error" && state.library.activeFilter === filter && !state.library.itemIdsByFilter[filter]) {
    renderMessage(qs("#libraryResults"), `YouTube Music library unavailable: ${state.library.error}`);
    return;
  }

  renderList(qs("#libraryResults"), libraryItems(), libraryEmptyText());
}

function librarySummaryTitle(): string {
  switch (state.libraryFilter) {
    case "Songs":
      return "Liked songs";
    case "Saved songs":
      return "Saved songs";
    case "Albums":
      return "Albums";
    case "Playlists":
      return "Playlists";
    case "Artists":
      return "Artists";
    default:
      return "Library";
  }
}

function libraryItems(): Track[] {
  if (libraryApiFilter() === "songs") return favoriteTrackIds().map(trackById);
  return (state.library.itemIdsByFilter[libraryApiFilter()] || []).map(trackById);
}

function libraryEmptyText(): string {
  if (state.library.status === "loading") return "Loading YouTube Music library items...";
  return `No ${state.libraryFilter.toLowerCase()} found yet`;
}

function playLibrary(shuffle = false): void {
  const playable = libraryItems().filter((track) => track.playable !== false);
  if (!playable.length) {
    showToast("No playable songs in this library view");
    return;
  }

  startQueue(playable, shuffle);
}

/**
 * Starts [tracks] as the playing context.
 *
 * The source is kept in its natural order even when starting shuffled: it is what a repeat-all wrap
 * draws from, and what turning shuffle back off restores the upcoming tracks to.
 */
function startQueue(tracks: Track[], shuffle: boolean): void {
  if (shuffle) state.shuffle = true;

  const ordered = state.shuffle ? shuffled(tracks) : tracks;
  state.queueSource = tracks.map((track) => track.id);
  state.queue = ordered.slice(1).map((track) => track.id);
  state.history = [];
  playTrack(ordered[0].id, { recordHistory: false });
}

function shuffled<T>(items: T[]): T[] {
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index--) {
    const target = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function toggleShuffle(): void {
  state.shuffle = !state.shuffle;

  if (state.shuffle) {
    if (state.queue.length > 1) state.queue = shuffled(state.queue);
  } else if (state.queueSource.length) {
    // Turning shuffle off puts what is still upcoming back into the order the playlist actually has,
    // rather than leaving it in whatever order the shuffle left behind.
    const upcoming = new Set(state.queue);
    state.queue = state.queueSource.filter((id) => upcoming.has(id));
  }

  showToast(state.shuffle ? "Shuffle on" : "Shuffle off");
  render();
  saveState();
}

function cycleRepeatMode(): void {
  state.repeatMode = state.repeatMode === "off" ? "all" : state.repeatMode === "all" ? "one" : "off";
  showToast(state.repeatMode === "one" ? "Repeat one" : state.repeatMode === "all" ? "Repeat all" : "Repeat off");
  render();
  saveState();
}

function openQueuePanel(): void {
  delete qs<HTMLElement>(".device-frame").dataset.nowClosing;
  if (state.route !== "now") routeBeforeNow = state.route;
  state.route = "now";
  state.nowQueueOpen = true;
  state.nowLyricsOpen = false;
  state.lyricsFullscreen = false;
  render();
}

function renderMessage(container: HTMLElement, text: string): void {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = text;
  container.replaceChildren(empty);
}

function renderList(container: HTMLElement, list: Track[], emptyText: string): void {
  if (!list.length) {
    renderMessage(container, emptyText);
    return;
  }
  container.replaceChildren(...list.map((track) => {
    const row = document.createElement("article");
    row.className = `list-row${track.id === state.currentTrackId ? " active" : ""}`;
    setArtVars(row, track);
    const liked = state.favorites.has(track.id);
    const action = track.playable !== false
      ? `<button class="more-button row-like-button${liked ? " active" : ""}" type="button" data-row-like aria-label="${liked ? "Remove from liked songs" : "Add to liked songs"}" aria-pressed="${liked}">${heartIconSvg()}</button>`
      : `<button class="more-button" type="button" data-row-open aria-label="Open ${escapeHtml(track.type)}">›</button>`;
    row.innerHTML = `<div class="thumb ${track.type === "Artist" ? "round" : ""}"></div><div class="list-text"><strong>${escapeHtml(track.title)}</strong><span>${escapeHtml(trackSubtitle(track))}</span></div>${action}`;
    row.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-row-like]")) void toggleFavorite(track.id);
      else openTrack(track.id);
    });
    return row;
  }));
}

function heartIconSvg(): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path class="heart-fill" d="M12 21s-7-4.4-9.3-8.8C.8 8.4 3.1 5 6.8 5c2 0 3.4 1 4.2 2.1C11.8 6 13.2 5 15.2 5c3.7 0 6 3.4 4.1 7.2C19 16.6 12 21 12 21z" /><path class="heart-outline" d="M12 19.1c2.4-1.6 5.2-4 6.1-6.2.7-1.4.6-2.8-.1-3.9-.6-1.1-1.6-1.7-2.8-1.7-1.3 0-2.1.6-2.8 1.5L12 9.5l-.8-.7c-.7-.9-1.5-1.5-2.8-1.5-1.2 0-2.2.6-2.8 1.7-.7 1.1-.8 2.5-.1 3.9.9 2.2 3.7 4.6 6.5 6.2zM12 21s-7-4.4-9.3-8.8C.8 8.4 3.1 5 6.8 5c2 0 3.4 1 4.2 2.1C11.8 6 13.2 5 15.2 5c3.7 0 6 3.4 4.1 7.2C19 16.6 12 21 12 21z" /></svg>`;
}

function renderDetail(): void {
  setText("#detailKind", state.detail.kind ? state.detail.kind.toUpperCase() : "Collection");
  setText("#detailTitle", state.detail.title || "Collection");
  setText("#detailSubtitle", state.detail.subtitle || "");
  const playableItems = detailPlayableTracks();
  ["#detailPlayButton", "#detailShuffleButton"].forEach((selector) => {
    qs<HTMLButtonElement>(selector).disabled = playableItems.length === 0 || state.detail.status === "loading";
  });
  const art = qs<HTMLElement>("#detailArt");
  if (state.detail.thumbnail) {
    art.style.setProperty("--art-image", `url("${state.detail.thumbnail.replace(/"/g, "%22")}")`);
    art.style.setProperty("--art-a", currentTrack().colorA);
    art.style.setProperty("--art-b", currentTrack().colorB);
    art.style.setProperty("--art-c", currentTrack().colorC);
  } else {
    const headerTrack = state.detail.itemId ? trackById(state.detail.itemId) : currentTrack();
    setArtVars(art, headerTrack);
  }

  if (state.detail.status === "loading") {
    renderMessage(qs("#detailResults"), "Loading tracks...");
    return;
  }

  if (state.detail.status === "error") {
    renderMessage(qs("#detailResults"), state.detail.error || "Unable to load this collection");
    return;
  }

  renderList(qs("#detailResults"), state.detail.trackIds.map(trackById), "No tracks found");
}

function detailPlayableTracks(): Track[] {
  return state.detail.trackIds.map(trackById).filter((track) => track.playable !== false);
}

function playDetail(shuffle = false): void {
  const playable = detailPlayableTracks();
  if (!playable.length) {
    showToast(state.detail.status === "loading" ? "Still loading tracks" : "No playable songs here");
    return;
  }

  startQueue(playable, shuffle);
}

function renderPlayer(): void {
  const track = currentTrack();
  const isEmpty = isEmptyTrack(track);
  const isLoading = state.loadingTrackId === track.id;
  const artistLabel = isEmpty ? "Choose music from Home, Search, Explore, or Library" : isLoading ? "Buffering audio..." : state.playbackError ? "Playback unavailable" : track.artist;
  ["#miniDisc", "#heroArt", "#sideArt", "#playerArt", "#lyricsPoster", ".web-now-panel"].forEach((selector) => setArtVars(qs<HTMLElement>(selector), track));
  setArtVars(qs<HTMLElement>("#nowPageArt"), track);
  setArtVars(qs<HTMLElement>("#nowPageLyricsOverlay"), track);
  qs<HTMLElement>("#playerSheet").style.setProperty("--sheet-a", track.colorA);
  qs<HTMLElement>("#playerSheet").style.setProperty("--sheet-b", track.colorB);
  const duration = isEmpty ? 0 : Math.max(0, track.duration || player.audio.duration || 0);
  const progress = duration ? Math.min(1, state.position / duration) : 0;
  qs<HTMLElement>("#miniDisc").style.setProperty("--progress", `${progress * 360}deg`);
  setText("#heroTitle", track.title);
  setText("#heroArtist", artistLabel);
  setText("#sideTitle", track.title);
  setText("#sideArtist", artistLabel);
  setText("#miniTitle", track.title);
  setText("#miniArtist", artistLabel);
  setText("#sheetTitle", track.title);
  setText("#sheetArtist", artistLabel);
  setText("#nowPageTitle", track.title);
  setText("#nowPageArtist", artistLabel);
  renderArtistNavLinks(track, !isEmpty && artistLabel === track.artist && Boolean(track.artistId));
  setText("#sheetCurrentTime", formatTime(state.position));
  setText("#barCurrentTime", formatTime(state.position));
  setText("#nowPageCurrentTime", formatTime(state.position));
  setText("#lyricsCurrentTime", formatTime(state.position));
  setText("#sheetDuration", duration ? formatTime(duration) : "--:--");
  setText("#barDuration", duration ? formatTime(duration) : "--:--");
  setText("#nowPageDuration", duration ? formatTime(duration) : "--:--");
  setText("#lyricsDuration", duration ? formatTime(duration) : "--:--");
  qs<HTMLInputElement>("#sheetProgress").value = String(Math.round(progress * 1000));
  qs<HTMLInputElement>("#barProgress").value = String(Math.round(progress * 1000));
  qs<HTMLInputElement>("#nowPageProgress").value = String(Math.round(progress * 1000));
  qs<HTMLInputElement>("#lyricsProgress").value = String(Math.round(progress * 1000));
  ["#miniPlayButton", "#sheetPlayButton", "#nowPagePlayButton", "#lyricsPlayButton"].forEach((selector) => {
    const button = qs<HTMLButtonElement>(selector);
    button.innerHTML = playIcon(isLoading);
    button.disabled = isLoading || isEmpty;
    button.classList.toggle("loading", isLoading);
    button.setAttribute("aria-busy", String(isLoading));
    button.setAttribute("aria-label", isEmpty ? "Choose music to play" : isLoading ? "Buffering" : state.isPlaying ? "Pause" : "Play");
  });
  qsa<HTMLButtonElement>("#sheetFavoriteButton, #sideFavoriteButton, #nowPageFavoriteButton").forEach((button) => {
    button.disabled = isEmpty;
  });
  qsa<HTMLButtonElement>("#sheetFavoriteButton, #sideFavoriteButton, #nowPageFavoriteButton").forEach((button) => {
    const liked = state.favorites.has(track.id);
    button.classList.toggle("active", liked);
    button.setAttribute("aria-label", liked ? "Remove from liked songs" : "Add to liked songs");
    button.setAttribute("aria-pressed", String(liked));
  });
  qsa<HTMLButtonElement>("#barShuffleButton, #sheetShuffleButton, #nowPageShuffleButton, #lyricsShuffleButton").forEach((button) => {
    button.classList.toggle("active", state.shuffle);
    button.setAttribute("aria-label", state.shuffle ? "Shuffle on" : "Shuffle off");
  });
  qsa<HTMLButtonElement>("#barRepeatButton, #sheetRepeatButton, #nowPageRepeatButton, #lyricsRepeatButton").forEach((button) => {
    button.classList.toggle("active", state.repeatMode !== "off");
    button.dataset.mode = state.repeatMode;
    button.setAttribute("aria-label", state.repeatMode === "one" ? "Repeat one" : state.repeatMode === "all" ? "Repeat all" : "Repeat off");
  });
  qs<HTMLElement>("#nowPageLyricsOverlay").classList.toggle("active", state.nowLyricsOpen);
  qs<HTMLElement>("#nowPageLyricsOverlay").dataset.mode = state.lyricsMode;
  qs<HTMLElement>("#nowPageLyricsOverlay").dataset.timing = lyricsTimingMode(track);
  qs("#nowPageLyricsOverlay").setAttribute("aria-hidden", String(!state.nowLyricsOpen));
  qs<HTMLElement>("#nowPageLyricsButton").classList.toggle("active", state.nowLyricsOpen);
  qs("#nowPageLyricsButton").setAttribute("aria-expanded", String(state.nowLyricsOpen));
  qs<HTMLElement>("#nowPageQueueButton").classList.toggle("active", state.nowQueueOpen);
  qs("#nowPageQueueButton").setAttribute("aria-expanded", String(state.nowQueueOpen));
  qs<HTMLElement>("#nowPageLyricsOverlay").classList.toggle("fullscreen", state.lyricsFullscreen);
  const lyricsFullscreenButton = qs<HTMLButtonElement>("#lyricsFullscreenButton");
  lyricsFullscreenButton.innerHTML = lyricsSizeIcon(state.lyricsFullscreen);
  lyricsFullscreenButton.classList.toggle("active", state.lyricsFullscreen);
  lyricsFullscreenButton.setAttribute("aria-label", state.lyricsFullscreen ? "Shrink lyrics" : "Expand lyrics");
  lyricsFullscreenButton.setAttribute("aria-expanded", String(state.lyricsFullscreen));
  qsa<HTMLElement>("[data-lyrics-mode]").forEach((button) => button.classList.toggle("active", button.getAttribute("data-lyrics-mode") === state.lyricsMode));
  const lyricsOffsetLabel = qs<HTMLElement>("#lyricsOffsetLabel");
  lyricsOffsetLabel.textContent = formatLyricsSyncLabel();
  lyricsOffsetLabel.setAttribute("role", "button");
  lyricsOffsetLabel.setAttribute("tabindex", "0");
  lyricsOffsetLabel.title = "Reset lyrics sync offset";
  lyricsOffsetLabel.setAttribute("aria-label", "Reset lyrics sync offset");
  renderLyrics();
  renderQueue();
  renderRightRail();
  updateMediaSession(track);
}

function ensureLyricsOffsetControls(): void {
  const controls = document.querySelector<HTMLElement>(".lyrics-offset-controls");
  if (!controls || controls.querySelector("#lyricsOffsetBackLargeButton")) return;

  const backButton = qs<HTMLElement>("#lyricsOffsetBackButton");
  const forwardButton = qs<HTMLElement>("#lyricsOffsetForwardButton");
  const backLarge = document.createElement("button");
  const forwardLarge = document.createElement("button");

  backLarge.type = "button";
  backLarge.id = "lyricsOffsetBackLargeButton";
  backLarge.textContent = "-5s";
  backLarge.setAttribute("aria-label", "Move lyrics 5 seconds earlier");

  forwardLarge.type = "button";
  forwardLarge.id = "lyricsOffsetForwardLargeButton";
  forwardLarge.textContent = "+5s";
  forwardLarge.setAttribute("aria-label", "Move lyrics 5 seconds later");

  controls.insertBefore(backLarge, backButton);
  controls.insertBefore(forwardLarge, forwardButton.nextSibling);
}

function setText(selector: string, text: string): void {
  qs(selector).textContent = text;
}

function renderArtistNavLinks(track: Track, enabled: boolean): void {
  ["#sideArtist", "#sheetArtist", "#nowPageArtist"].forEach((selector) => {
    const element = qs<HTMLElement>(selector);
    element.classList.toggle("artist-nav-link", enabled);
    if (enabled) {
      element.setAttribute("role", "link");
      element.setAttribute("tabindex", "0");
      element.setAttribute("aria-label", `Open ${track.artist}`);
    } else {
      element.removeAttribute("role");
      element.removeAttribute("tabindex");
      element.removeAttribute("aria-label");
    }
  });
}

function playIcon(isLoading: boolean): string {
  if (isLoading) return `<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 10 10h-2a8 8 0 1 1-8-8z" /></svg>`;
  return state.isPlaying ? `<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zm6 0h4v14h-4z" /></svg>` : `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>`;
}

function lyricsSizeIcon(isFullscreen: boolean): string {
  if (isFullscreen) return `<svg viewBox="0 0 24 24"><path d="M9 3h2v6H5V7h2.6L4.3 3.7l1.4-1.4L9 5.6zm6 0 3.3-.7 1.4 1.4L16.4 7H19v2h-6V3zm-4 12v6H9v-2.6l-3.3 3.3-1.4-1.4L7.6 17H5v-2zm8 0v2h-2.6l3.3 3.3-1.4 1.4-3.3-3.3V21h-2v-6z" /></svg>`;
  return `<svg viewBox="0 0 24 24"><path d="M5 5h6v2H8.4l3.3 3.3-1.4 1.4L7 8.4V11H5zm8 0h6v6h-2V8.4l-3.3 3.3-1.4-1.4L15.6 7H13zM10.3 12.3l1.4 1.4L8.4 17H11v2H5v-6h2v2.6zm3.4 0 3.3 3.3V13h2v6h-6v-2h2.6l-3.3-3.3z" /></svg>`;
}

function renderLyrics(): void {
  const track = currentTrack();
  const sheetLyrics = qs<HTMLElement>("#lyricsPage");
  const overlayLyrics = qs<HTMLElement>("#nowPageOverlayLyrics");
  const lyricContainers = [sheetLyrics, overlayLyrics];
  if (player.isRemoteTrack(track) && !track.lyricsStatus && !track.lyrics.length) {
    void loadLyricsForTrack(track.id);
    lyricContainers.forEach((container) => renderMessage(container, "Loading lyrics..."));
    stopLyricsAnimation();
    return;
  }

  if (track.lyricsStatus === "loading") {
    lyricContainers.forEach((container) => renderMessage(container, "Loading lyrics..."));
    stopLyricsAnimation();
    return;
  }

  if (track.lyricsStatus === "error") {
    lyricContainers.forEach((container) => renderMessage(container, track.lyricsError || "Lyrics unavailable"));
    stopLyricsAnimation();
    return;
  }

  if (!track.lyrics.length) {
    lyricContainers.forEach((container) => renderMessage(container, "Lyrics unavailable"));
    stopLyricsAnimation();
    return;
  }
  const adjustedPosition = syncedLyricsPosition();
  const activeIndex = activeLyricIndex(track);
  const createLine = ({ time, text, index }: { time: number; text: string; index: number }) => {
    const line = document.createElement("p");
    const next = track.lyrics[index + 1]?.[0] ?? track.duration + 1;
    const isActive = track.lyricsSynced !== false && time >= 0 && adjustedPosition >= time && adjustedPosition < next;
    const distance = Math.abs(index - activeIndex);
    line.className = `lyric-line${isActive ? " active" : ""}${track.lyricsSynced && distance > 2 ? " far" : ""}`;
    line.dataset.index = String(index);
    if (track.lyricsSynced !== false && time >= 0) {
      line.tabIndex = 0;
      line.setAttribute("role", "button");
      line.setAttribute("aria-label", `Sync this lyric line to the current playback time: ${text}`);
      line.addEventListener("click", () => syncLyricsLineToPlayback(time));
      line.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        syncLyricsLineToPlayback(time);
      });
    }
    setLyricTiming(line, time, next, adjustedPosition, isActive);
    line.textContent = text;
    return line;
  };

  const compactLines = visibleLyricWindow(track, "focus").map(createLine);
  const fullLines = visibleLyricWindow(track, state.lyricsMode).map(createLine);
  sheetLyrics.replaceChildren(...compactLines);
  overlayLyrics.replaceChildren(...fullLines);

  if (state.nowLyricsOpen && track.lyricsSynced) {
    window.requestAnimationFrame(() => {
      overlayLyrics.querySelector(".lyric-line.active")?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }
  startLyricsAnimation();
}

function setLyricTiming(line: HTMLElement, start: number, next: number, position: number, active: boolean): void {
  const safeStart = Math.max(0, start);
  const safeNext = next > safeStart ? next : safeStart + 2.8;
  const duration = Math.max(0.8, safeNext - safeStart);
  const elapsed = active ? Math.max(0, Math.min(duration, position - safeStart)) : 0;
  const timingMode = qs<HTMLElement>("#nowPageLyricsOverlay").dataset.timing;
  const progress = active && timingMode === "calibrated" && duration ? Math.max(0, Math.min(1, elapsed / duration)) : 0;

  line.style.setProperty("--lyric-duration", `${duration.toFixed(2)}s`);
  line.style.setProperty("--lyric-progress", `${(progress * 100).toFixed(2)}%`);
}

function syncLyricsLineToPlayback(lineStartSeconds: number): void {
  if (lineStartSeconds < 0) return;
  const trackId = state.currentTrackId;
  const playbackMs = Math.round(playbackPositionSeconds() * 1000 + lyricsLeadMs);
  const lyricMs = Math.round(lineStartSeconds * 1000);
  const previous = currentLyricsCalibration();

  if (trackId && previous) {
    const playbackGapMs = playbackMs - previous.lastPlaybackMs;
    const lyricGapMs = lyricMs - previous.lastLyricMs;
    const canCalibrateDrift = Math.abs(playbackGapMs) >= lyricsCalibrationMinGapMs && Math.abs(lyricGapMs) >= lyricsCalibrationMinLyricGapMs;
    const nextRate = canCalibrateDrift ? lyricGapMs / playbackGapMs : 1;

    if (canCalibrateDrift && nextRate >= lyricsCalibrationMinRate && nextRate <= lyricsCalibrationMaxRate) {
      state.lyricsCalibrations = {
        ...state.lyricsCalibrations,
        [trackId]: {
          anchorPlaybackMs: previous.lastPlaybackMs,
          anchorLyricMs: previous.lastLyricMs,
          rate: nextRate,
          lastPlaybackMs: playbackMs,
          lastLyricMs: lyricMs,
        },
      };
      renderPlayer();
      saveState();
      showToast(`Lyrics speed calibrated ${formatLyricsRate(nextRate)}`);
      return;
    }
  }

  setCurrentLyricsCalibration(playbackMs, lyricMs);
  renderPlayer();
  saveState();
  showToast(`Lyrics sync set to ${formatLyricsSyncLabel()}`);
}

function startLyricsAnimation(): void {
  if (lyricsAnimationFrame || !shouldAnimateLyrics()) return;
  lyricsAnimationFrame = window.requestAnimationFrame(updateLyricsAnimation);
}

function stopLyricsAnimation(): void {
  if (!lyricsAnimationFrame) return;
  window.cancelAnimationFrame(lyricsAnimationFrame);
  lyricsAnimationFrame = 0;
}

function shouldAnimateLyrics(): boolean {
  const track = currentTrack();
  return state.nowLyricsOpen && state.isPlaying && track.lyricsSynced !== false && track.lyrics.length > 0;
}

function updateLyricsAnimation(): void {
  lyricsAnimationFrame = 0;
  if (!shouldAnimateLyrics()) return;

  const track = currentTrack();
  const activeIndex = activeLyricIndex(track);
  const activeEntry = track.lyrics[activeIndex];
  const activeLine = qs<HTMLElement>("#nowPageOverlayLyrics").querySelector<HTMLElement>(`.lyric-line[data-index="${activeIndex}"]`);

  if (!activeEntry || !activeLine?.classList.contains("active")) {
    renderLyrics();
    return;
  } else {
    setLyricTiming(activeLine, activeEntry[0], track.lyrics[activeIndex + 1]?.[0] ?? track.duration + 1, syncedLyricsPosition(), true);
  }

  lyricsAnimationFrame = window.requestAnimationFrame(updateLyricsAnimation);
}

function visibleLyricWindow(track: Track, mode: AppState["lyricsMode"]): Array<{ time: number; text: string; index: number }> {
  const lyrics = indexedLyrics(track);
  if (mode === "full") return lyrics;
  if (!track.lyricsSynced) return lyrics.slice(0, mode === "compact" ? 3 : 6);
  const activeIndex = activeLyricIndex(track);
  const center = activeIndex === -1 ? 0 : activeIndex;
  const radius = mode === "compact" ? 1 : 3;
  const start = Math.max(0, center - radius);
  return lyrics.slice(start, start + radius * 2 + 1);
}

function indexedLyrics(track: Track): Array<{ time: number; text: string; index: number }> {
  return track.lyrics.map(([time, text], index) => ({ time, text, index }));
}

function activeLyricIndex(track: Track): number {
  let activeIndex = -1;
  const adjustedPosition = syncedLyricsPosition();
  track.lyrics.forEach(([time], index) => {
    if (time >= 0 && time <= adjustedPosition) activeIndex = index;
  });
  return activeIndex;
}

function renderQueue(): void {
  const rows = [state.currentTrackId, ...state.queue].filter(Boolean).map(trackById);
  if (state.next.status === "loading") {
    if (state.route !== "now") renderMessage(qs("#sideQueue"), "Loading Up Next...");
  } else {
    if (state.route !== "now") {
      const queueIds = state.queue.length ? state.queue : playableKnownTracks().filter((track) => track.id !== state.currentTrackId).slice(0, 5).map((track) => track.id);
      if (queueIds.length) qs("#sideQueue").replaceChildren(...queueIds.slice(0, 5).map((id) => queueRow(trackById(id), trackById(id).artist)));
      else renderMessage(qs("#sideQueue"), "Choose music to start a queue");
    }
  }

  if (state.next.status === "loading" && state.queue.length === 0) {
    renderMessage(qs("#queuePage"), "Loading Up Next...");
    return;
  }

  if (rows.length) qs("#queuePage").replaceChildren(...rows.map((track, index) => queueRow(track, index === 0 ? "Now playing" : track.artist)));
  else renderMessage(qs("#queuePage"), "No tracks queued yet");
}

function renderRightRail(): void {
  const panel = qs<HTMLElement>(".web-now-panel");
  const title = qs<HTMLElement>(".web-now-panel .panel-header h2");
  const sectionTitle = qs<HTMLElement>(".side-queue-section h3");
  if (state.route !== "now") {
    panel.dataset.mode = "player";
    title.textContent = "Now playing";
    sectionTitle.textContent = "Up next";
    return;
  }

  if (state.nowQueueOpen) {
    panel.dataset.mode = "queue";
    title.textContent = "Queue";
    sectionTitle.textContent = "Up next";
    if (state.next.status === "loading" && state.queue.length === 0) renderMessage(qs("#sideQueue"), "Loading Up Next...");
    else if (state.queue.length) qs("#sideQueue").replaceChildren(...state.queue.map((id) => queueRow(trackById(id), trackById(id).artist)));
    else renderMessage(qs("#sideQueue"), "No tracks queued yet");
    return;
  }

  panel.dataset.mode = "library";
  title.textContent = "Music library";
  sectionTitle.textContent = "Saved music";
  qs("#sideQueue").replaceChildren(
    libraryRailRow("Liked songs", `${favoriteTrackIds().length} saved`, "liked", () => {
      state.route = "library";
      state.libraryFilter = "Library";
      render();
    }),
    libraryRailRow("Library songs", `${state.library.itemIdsByFilter.saved_songs?.length ?? playableKnownTracks().length} from YouTube Music`, "downloaded", () => {
      state.route = "library";
      state.libraryFilter = "Saved songs";
      render();
      void loadLibraryForFilter("saved_songs");
    }),
    libraryRailRow("Playlists", `${state.library.itemIdsByFilter.playlists?.length ?? 0} playlists`, "mixes", () => {
      state.route = "library";
      state.libraryFilter = "Playlists";
      render();
      void loadLibraryForFilter("playlists");
    }),
    ...knownTracks().filter((track) => track.id !== state.currentTrackId).slice(0, 6).map((track) => queueRow(track, track.artist)),
  );
}

function libraryRailRow(title: string, subtitle: string, artClass: string, onClick: () => void): HTMLElement {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "library-rail-row";
  row.innerHTML = `<span class="shortcut-art ${artClass}"></span><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(subtitle)}</small></span>`;
  row.addEventListener("click", onClick);
  return row;
}

function queueRow(track: Track, subtitle: string): HTMLElement {
  const row = document.createElement("article");
  row.className = "queue-row";
  setArtVars(row, track);
  row.innerHTML = `<div class="thumb"></div><div class="list-text"><strong>${escapeHtml(track.title)}</strong><span>${escapeHtml(subtitle)}</span></div>`;
  row.addEventListener("click", () => playTrack(track.id));
  return row;
}

function openTrack(trackId: string): void {
  const track = trackById(trackId);
  if (track.playable === false) {
    void openDetail(track);
    return;
  }
  playTrack(trackId);
}

async function openDetail(track: Track): Promise<void> {
  if (track.type.toLowerCase() === "artist") {
    const artistId = track.browseId || track.artistId || track.id;
    if (!artistId) {
      showToast("Singer page unavailable");
      return;
    }
    await openBrowseDetail("artist", track.title, artistId, "", track.album || "Artist", track.thumbnail, track.id, "Unable to load this singer");
    return;
  }

  const kind = track.type.toLowerCase() === "album" ? "album" : track.type.toLowerCase() === "playlist" ? "playlist" : null;
  const id = kind === "album" ? track.browseId || track.albumId || track.id : kind === "playlist" ? track.playlistId || track.id : "";
  if (!kind || !id) {
    showToast(`${track.type} pages are next`);
    return;
  }

  await openCollectionDetail(kind, id, track.title, track.artist, track.thumbnail, track.id);
}

async function openCollectionDetail(kind: "album" | "playlist", id: string, title: string, subtitle: string, thumbnail: string | undefined, itemId: string): Promise<void> {
  if (!id) {
    showToast(`${kind === "album" ? "Album" : "Playlist"} page unavailable`);
    return;
  }

  state.route = "detail";
  state.detail = {
    status: "loading",
    kind,
    itemId,
    title,
    subtitle,
    thumbnail,
    trackIds: [],
    error: "",
  };
  render();

  try {
    const detail = await loadDetail(kind, id, mergeTrack);
    state.detail = {
      ...state.detail,
      status: "ready",
      itemId: detail.item.id,
      title: detail.item.title,
      subtitle: detail.item.artist,
      thumbnail: detail.item.thumbnail,
      trackIds: detail.trackIds,
      error: "",
    };
  } catch (error) {
    state.detail = {
      ...state.detail,
      status: "error",
      error: error instanceof Error ? error.message : "Unable to load this collection",
    };
  }
  render();
}

async function openBrowseDetail(kind: "artist" | "browse", title: string, browseId: string, params: string, subtitle: string, thumbnail: string | undefined, itemId: string, fallbackError: string): Promise<void> {
  state.route = "detail";
  state.nowLyricsOpen = false;
  state.nowQueueOpen = false;
  state.lyricsFullscreen = false;
  state.detail = {
    status: "loading",
    kind,
    itemId,
    title,
    subtitle,
    thumbnail,
    trackIds: [],
    error: "",
  };
  render();

  try {
    const browse = await loadBrowseData(browseId, params, mergeTrack);
    state.detail = {
      ...state.detail,
      status: "ready",
      title: browse.title || title,
      subtitle,
      thumbnail: browse.thumbnail || thumbnail,
      trackIds: browse.trackIds,
      error: "",
    };
  } catch (error) {
    state.detail = {
      ...state.detail,
      status: "error",
      error: error instanceof Error ? error.message : fallbackError,
    };
  }
  render();
}

async function openCurrentArtist(): Promise<void> {
  const track = currentTrack();
  if (isEmptyTrack(track) || !track.artistId) {
    showToast("Singer page unavailable for this song");
    return;
  }
  await openBrowseDetail("artist", track.artist, track.artistId, "", "Songs, albums, and playlists", track.thumbnail, track.artistId, "Unable to load this singer");
}

function renderSheetPages(): void {
  qsa<HTMLElement>(".player-page-button[data-player-page]").forEach((button) => button.classList.toggle("active", button.dataset.playerPage === state.playerPage));
  qsa<HTMLElement>(".sheet-page").forEach((page) => page.classList.remove("active"));
  qs(`#${state.playerPage}Page`).classList.add("active");
}

function playTrack(trackId: string, options: { recordHistory?: boolean } = {}): void {
  const track = trackById(trackId);
  if (track.playable === false) {
    showToast(`${track.type} pages are next`);
    return;
  }
  const isRemote = player.isRemoteTrack(track);

  // Everything that starts a track records what it displaced, so "previous" can retrace what was
  // actually heard. Stepping backwards is the one exception: it is consuming history, not making it.
  if (options.recordHistory !== false && state.currentTrackId && state.currentTrackId !== trackId) {
    state.history.push(state.currentTrackId);
    if (state.history.length > MAX_HISTORY) state.history.shift();
  }

  if (state.currentTrackId !== trackId && player.audio.src) player.stop();
  state.currentTrackId = trackId;
  state.position = 0;
  state.isPlaying = !isRemote;
  state.loadingTrackId = isRemote ? track.id : null;
  state.playbackError = "";
  const queueSource = state.search.results.includes(trackId) ? state.search.results.map(trackById) : playableKnownTracks();
  state.queue = queueSource.filter((candidate) => candidate.id !== trackId && candidate.playable !== false).slice(0, 4).map((candidate) => candidate.id);
  render();
  if (isRemote) {
    void loadQueueForTrack(track.id);
    void loadLyricsForTrack(track.id);
    player.play(track).catch((error: unknown) => {
      if (state.currentTrackId !== track.id) return;
      state.isPlaying = false;
      state.loadingTrackId = null;
      state.playbackError = error instanceof Error ? error.message : "Playback failed";
      player.stop();
      showToast(state.playbackError);
    }).finally(() => {
      if (state.currentTrackId === track.id && state.loadingTrackId === track.id) {
        state.loadingTrackId = null;
        renderPlayer();
      }
    });
  } else {
    player.stop();
  }
}

async function loadLyricsForTrack(trackId: string, force = false): Promise<void> {
  const track = trackById(trackId);
  if (track.lyricsStatus === "loading") return;

  await ensureTrackDuration(track);
  if (state.currentTrackId !== trackId) return;

  const matchDuration = track.duration || 0;
  const hasCurrentLyrics = track.lyrics.length > 0 && track.lyricsStatus === "ready" && track.lyricsMatchDuration === matchDuration;
  if (!force && hasCurrentLyrics) return;

  track.lyricsStatus = "loading";
  track.lyricsError = "";
  renderLyrics();

  try {
    const lyrics = await loadLyrics(track);
    if (state.currentTrackId !== trackId) return;
    const syncedLyrics = lyrics.synced ? lyrics.entries.map((entry) => [entry.time, entry.text] as [number, string]) : [];
    track.lyrics = syncedLyrics.length ? syncedLyrics : lyrics.lines.map((line) => [-1, line]);
    track.lyricsSynced = syncedLyrics.length > 0;
    track.lyricsSource = lyrics.source;
    track.lyricsMatchDuration = matchDuration;
    track.lyricsStatus = "ready";
    console.info("OpenTune lyrics matched", {
      trackId,
      title: track.title,
      artist: track.artist,
      source: lyrics.source,
      synced: track.lyricsSynced,
      duration: matchDuration,
    });
  } catch (error) {
    track.lyricsStatus = "error";
    track.lyricsError = error instanceof Error ? error.message : "Lyrics unavailable";
  }

  if (state.currentTrackId === trackId) renderLyrics();
}

async function ensureTrackDuration(track: Track): Promise<void> {
  if (track.duration > 0 || !player.isRemoteTrack(track)) return;
  const metadata = await playerMetadata(track.id);
  if (metadata.durationSeconds) track.duration = metadata.durationSeconds;
  if (metadata.thumbnail) track.thumbnail = metadata.thumbnail;
}
async function loadQueueForTrack(trackId: string): Promise<void> {
  const requestId = state.next.requestId + 1;
  state.next = { ...state.next, status: "loading", error: "", requestId };
  renderQueue();

  try {
    const next = await loadNextQueue(trackId, mergeTrack);
    if (state.next.requestId !== requestId || state.currentTrackId !== trackId) return;
    state.next = { status: "ready", title: next.title, error: "", requestId };
    state.queue = next.trackIds.filter((id) => id !== trackId).slice(0, 24);
  } catch (error) {
    if (state.next.requestId !== requestId) return;
    state.next = { ...state.next, status: "error", error: error instanceof Error ? error.message : "Unable to load Up Next" };
  }
  renderQueue();
  saveState();
}

function togglePlay(): void {
  const track = currentTrack();
  if (isEmptyTrack(track)) {
    showToast("Choose a song to play");
    return;
  }
  if (player.isRemoteTrack(track)) {
    if (state.loadingTrackId === track.id) return;
    const needsBuffer = player.audio.getAttribute("data-track-id") !== track.id || !player.audio.src || player.audio.paused;
    if (needsBuffer) state.loadingTrackId = track.id;
    renderPlayer();
    player.toggle(track).catch((error: unknown) => {
      if (state.currentTrackId !== track.id) return;
      state.isPlaying = false;
      state.loadingTrackId = null;
      state.playbackError = error instanceof Error ? error.message : "Playback failed";
      player.stop();
      showToast(state.playbackError);
    }).finally(() => {
      if (state.currentTrackId === track.id && state.loadingTrackId === track.id) {
        state.loadingTrackId = null;
        renderPlayer();
      }
    });
    return;
  }
  state.isPlaying = !state.isPlaying;
  render();
}

/**
 * The next track in the queue, refilling from the source when repeat-all wraps it around.
 *
 * Shuffle belongs to the *order of the queue*, not to this choice. Picking at random here meant
 * drawing from every track the app happened to have loaded -- so shuffle wandered out of the
 * playlist you started, and could hand you the song already playing.
 */
function takeNextQueuedTrack(): string | undefined {
  if (state.queue.length) return state.queue.shift();
  if (state.repeatMode !== "all" || !state.queueSource.length) return undefined;

  // Repeat-all starts the whole context again. Refilling with everything *except* the current track
  // would quietly drop it from the next cycle, so take the full list and simply rotate it if it
  // would otherwise hand back the song that is playing right now.
  const refill = state.shuffle ? shuffled(state.queueSource) : state.queueSource.slice();
  if (refill.length > 1 && refill[0] === state.currentTrackId) refill.push(refill.shift() as string);

  state.queue = refill;
  return state.queue.shift();
}

function nextTrack(): void {
  if (state.repeatMode === "one" && !isEmptyTrack(currentTrack())) {
    playTrack(state.currentTrackId, { recordHistory: false });
    return;
  }

  const queued = takeNextQueuedTrack();
  if (queued) {
    playTrack(queued);
    return;
  }

  // Nothing queued: fall back to stepping through whatever is on screen, so a track played on its
  // own still advances.
  const playable = playableKnownTracks();
  if (!playable.length) return;
  const index = playable.findIndex((track) => track.id === state.currentTrackId);
  if (index === -1) return;
  if (state.repeatMode === "off" && index === playable.length - 1) return;
  playTrack(playable[(index + 1) % playable.length].id);
}

function previousTrack(): void {
  // Back to what was actually heard. This used to step backwards through the track *list* instead,
  // so after shuffle jumped from track 1 to track 4, "previous" offered track 3 -- a song that had
  // never played -- and with shuffle drawing from every loaded track it was often not even from the
  // same playlist.
  const previous = state.history.pop();
  if (previous) {
    if (state.currentTrackId) state.queue.unshift(state.currentTrackId);
    playTrack(previous, { recordHistory: false });
    return;
  }

  // Nothing has played before this. Restart rather than guess at a neighbour.
  if (!isEmptyTrack(currentTrack())) playTrack(state.currentTrackId, { recordHistory: false });
}

async function toggleFavorite(trackId: string): Promise<void> {
  const track = trackById(trackId);
  if (isEmptyTrack(track)) return;
  const wasLiked = state.favorites.has(trackId);
  if (wasLiked) {
    state.favorites.delete(trackId);
    suppressedFavoriteIds.add(trackId);
    showToast("Removed from liked songs");
  } else {
    suppressedFavoriteIds.delete(trackId);
    state.favorites.add(trackId);
    showToast("Added to liked songs");
  }
  state.library.itemIdsByFilter.songs = favoriteTrackIds();
  render();

  if (track.source !== "youtube" || track.playable === false) return;
  const liked = state.favorites.has(trackId);
  try {
    await setRemoteLike(track.id, liked);
    if (state.route === "library" || state.homeFilter === "Liked") void loadLibraryForFilter("songs", true);
  } catch (error) {
    if (wasLiked) {
      suppressedFavoriteIds.delete(trackId);
      state.favorites.add(trackId);
    } else {
      state.favorites.delete(trackId);
      suppressedFavoriteIds.add(trackId);
    }
    state.library.itemIdsByFilter.songs = favoriteTrackIds();
    showToast(error instanceof Error ? error.message : "Could not update YouTube Music like");
    render();
  }
}

function showToast(message: string): void {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  qs("#toastRegion").append(toast);
  window.setTimeout(() => toast.remove(), 2200);
}

function updateMediaSession(track: Track): void {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album,
    artwork: [{ src: track.thumbnail || "/assets/icon.png", sizes: "512x512", type: "image/png" }],
  });
  navigator.mediaSession.playbackState = state.isPlaying ? "playing" : "paused";
  navigator.mediaSession.setActionHandler("play", togglePlay);
  navigator.mediaSession.setActionHandler("pause", togglePlay);
  navigator.mediaSession.setActionHandler("previoustrack", previousTrack);
  navigator.mediaSession.setActionHandler("nexttrack", nextTrack);
}

function bindEvents(): void {
  ensureLyricsOffsetControls();
  qs("#historyBackButton").addEventListener("click", () => navigateHistory("back"));
  qs("#historyForwardButton").addEventListener("click", () => navigateHistory("forward"));
  qs("#accountChip").addEventListener("click", openAccountSheet);
  qs("#accountCloseButton").addEventListener("click", closeAccountSheet);
  qs("#accountBackdrop").addEventListener("click", closeAccountSheet);
  qs("#androidPairingButton").addEventListener("click", () => void startAndroidPairing());
  qs("#copyAndroidPairingLinkButton").addEventListener("click", () => void copyAndroidPairingLink());
  qs("#extensionLoginButton").addEventListener("click", handleExtensionLoginClick);
  qs("#installExtensionButton").addEventListener("click", installBrowserHelper);
  qs("#retryExtensionLoginButton").addEventListener("click", requestExtensionLogin);
  qs("#accountForm").addEventListener("submit", (event) => {
    event.preventDefault();
    void saveAccountSession();
  });
  qs("#logoutAuthButton").addEventListener("click", () => void logoutAccountSession());
  window.addEventListener("message", handleExtensionMessage);
  qs("#shortcutLikedSongs").addEventListener("click", () => {
    state.route = "library";
    state.libraryFilter = "Songs";
    render();
    void loadLibraryForFilter("songs");
  });
  qs("#shortcutLibrarySongs").addEventListener("click", () => {
    state.route = "library";
    state.libraryFilter = "Saved songs";
    render();
    void loadLibraryForFilter("saved_songs");
  });
  qs("#shortcutPlaylists").addEventListener("click", () => {
    state.route = "library";
    state.libraryFilter = "Playlists";
    render();
    void loadLibraryForFilter("playlists");
  });
  qs("#libraryPlayButton").addEventListener("click", () => playLibrary(false));
  qs("#libraryShuffleButton").addEventListener("click", () => playLibrary(true));
  qs("#detailPlayButton").addEventListener("click", () => playDetail(false));
  qs("#detailShuffleButton").addEventListener("click", () => playDetail(true));
  qsa<HTMLElement>("[data-route]").forEach((element) => element.addEventListener("click", () => {
    state.route = element.dataset.route as Route;
    render();
    if (state.route === "search") window.setTimeout(() => qs<HTMLInputElement>("#searchInput").focus(), 0);
  }));
  qs<HTMLInputElement>("#searchInput").addEventListener("input", (event) => {
    state.query = (event.target as HTMLInputElement).value;
    queueRemoteSearch(state.query);
  });
  qs<HTMLInputElement>("#searchInput").addEventListener("focus", () => {
    state.route = "search";
    render();
  });
  qs("#miniPlayer").addEventListener("click", toggleNowPage);
  ["#heroNowCard", "#sideOpenPlayer"].forEach((selector) => qs(selector).addEventListener("click", openNowPage));
  qs(".web-now-panel").addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (state.route === "now") return;
    if (target?.closest("button, .queue-row")) return;
    openNowPage();
  });
  qs("#nowPageCollapseButton").addEventListener("click", collapseNowPage);
  qsa<HTMLElement>("[data-close-player]").forEach((element) => element.addEventListener("click", closePlayer));
  ["#miniPlayButton", "#sheetPlayButton", "#nowPagePlayButton", "#lyricsPlayButton"].forEach((selector) => qs(selector).addEventListener("click", togglePlay));
  ["#miniNextButton", "#sheetNextButton", "#nowPageNextButton", "#lyricsNextButton"].forEach((selector) => qs(selector).addEventListener("click", nextTrack));
  ["#barPrevButton", "#sheetPrevButton", "#nowPagePrevButton", "#lyricsPrevButton"].forEach((selector) => qs(selector).addEventListener("click", previousTrack));
  ["#barShuffleButton", "#sheetShuffleButton", "#nowPageShuffleButton", "#lyricsShuffleButton"].forEach((selector) => qs(selector).addEventListener("click", toggleShuffle));
  ["#barRepeatButton", "#sheetRepeatButton", "#nowPageRepeatButton", "#lyricsRepeatButton"].forEach((selector) => qs(selector).addEventListener("click", cycleRepeatMode));
  qs("#barQueueButton").addEventListener("click", openQueuePanel);
  ["#sheetFavoriteButton", "#sideFavoriteButton", "#nowPageFavoriteButton"].forEach((selector) => qs(selector).addEventListener("click", () => void toggleFavorite(state.currentTrackId)));
  ["#sideArtist", "#sheetArtist", "#nowPageArtist"].forEach((selector) => {
    const element = qs<HTMLElement>(selector);
    element.addEventListener("click", (event) => {
      if (!element.classList.contains("artist-nav-link")) return;
      event.stopPropagation();
      void openCurrentArtist();
    });
    element.addEventListener("keydown", (event) => {
      if (!element.classList.contains("artist-nav-link")) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      void openCurrentArtist();
    });
  });
  ["#sheetProgress", "#barProgress", "#nowPageProgress", "#lyricsProgress"].forEach((selector) => qs<HTMLInputElement>(selector).addEventListener("input", (event) => seekToProgress((event.target as HTMLInputElement).value)));
  qs("#nowPageLyricsButton").addEventListener("click", () => {
    state.nowLyricsOpen = !state.nowLyricsOpen;
    state.nowQueueOpen = false;
    if (!state.nowLyricsOpen) state.lyricsFullscreen = false;
    renderPlayer();
  });
  qs("#nowPageLyricsCloseButton").addEventListener("click", () => {
    state.nowLyricsOpen = false;
    state.lyricsFullscreen = false;
    renderPlayer();
  });
  qs("#lyricsFullscreenButton").addEventListener("click", () => {
    state.lyricsFullscreen = !state.lyricsFullscreen;
    renderPlayer();
  });
  qs("#nowPageQueueButton").addEventListener("click", () => {
    state.nowQueueOpen = !state.nowQueueOpen;
    state.nowLyricsOpen = false;
    state.lyricsFullscreen = false;
    renderPlayer();
  });
  qsa<HTMLElement>("[data-lyrics-mode]").forEach((button) => button.addEventListener("click", () => {
    const mode = button.getAttribute("data-lyrics-mode");
    if (mode === "focus" || mode === "full" || mode === "compact") {
      state.lyricsMode = mode;
      renderLyrics();
      renderPlayer();
    }
  }));
  qs("#lyricsOffsetBackLargeButton").addEventListener("click", () => adjustLyricsOffset(-5000));
  qs("#lyricsOffsetBackButton").addEventListener("click", () => adjustLyricsOffset(-lyricsOffsetStepMs));
  qs("#lyricsOffsetForwardButton").addEventListener("click", () => adjustLyricsOffset(lyricsOffsetStepMs));
  qs("#lyricsOffsetForwardLargeButton").addEventListener("click", () => adjustLyricsOffset(5000));
  qs("#lyricsOffsetLabel").addEventListener("click", resetLyricsOffset);
  qs("#lyricsOffsetLabel").addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key !== "Enter" && (event as KeyboardEvent).key !== " ") return;
    event.preventDefault();
    resetLyricsOffset();
  });
  qsa<HTMLElement>(".player-page-button[data-player-page]").forEach((button) => button.addEventListener("click", () => {
    state.playerPage = button.dataset.playerPage === "queue" ? "queue" : "lyrics";
    renderSheetPages();
  }));
  document.addEventListener("keydown", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const interactiveTarget = target?.closest("button, [role='button'], input, textarea, select");
    if (event.code === "Escape" && state.accountOpen) {
      closeAccountSheet();
      return;
    }
    if (event.code === "Escape" && state.nowLyricsOpen) {
      state.nowLyricsOpen = false;
      state.lyricsFullscreen = false;
      renderPlayer();
      return;
    }
    if (event.code === "Escape") closePlayer();
    if (event.code === "Space" && !interactiveTarget) {
      event.preventDefault();
      togglePlay();
    }
  });
}

function adjustLyricsOffset(deltaMs: number): void {
  shiftCurrentLyricsSync(deltaMs);
  renderPlayer();
  saveState();
}

function resetLyricsOffset(): void {
  resetCurrentLyricsSync();
  renderPlayer();
  saveState();
  showToast("Lyrics sync reset");
}

function seekToProgress(value: string): void {
  const track = currentTrack();
  const duration = Math.max(0, track.duration || player.audio.duration || 0);
  if (!duration) return;
  state.position = (Number(value) / 1000) * duration;
  if (player.isRemoteTrack(track)) player.seek(state.position);
  renderPlayer();
  saveState();
}

function closePlayer(): void {
  qs<HTMLElement>(".device-frame").dataset.playerOpen = "false";
  qs("#playerSheet").setAttribute("aria-hidden", "true");
}

function tick(): void {
  if (player.isRemoteTrack(currentTrack()) || !state.isPlaying) return;
  state.position += 1;
  if (currentTrack().duration && state.position >= currentTrack().duration) {
    if (state.repeatMode === "one") state.position = 0;
    else {
      nextTrack();
      return;
    }
  }
  renderPlayer();
  saveState();
}
