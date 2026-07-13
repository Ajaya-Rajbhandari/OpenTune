import type {
  AuthSessionRequestDto,
  AuthStatusDto,
  BrowseResponseDto,
  ExploreResponseDto,
  HomeChip,
  HomeResponseDto,
  HomeSection,
  DetailResponseDto,
  LibraryResponseDto,
  LyricsResponseDto,
  NextResponseDto,
  PairingStartResponseDto,
  PairingStatusResponseDto,
  PlayerResponseDto,
  SearchResultsDto,
  SearchSuggestionsDto,
  SpeedDialItemDto,
  SpeedDialResponseDto,
  Track,
  WebItemDto,
} from "./types";

const apiBase = import.meta.env.VITE_API_BASE ?? "";

const ACCESS_TOKEN_HEADER = "X-OpenTune-Token";
const ACCESS_TOKEN_STORAGE_KEY = "opentune.accessToken";

/**
 * The API is token-protected because the server listens on every interface so a phone can reach it
 * for pairing. The server prints a URL with the token attached; capture it once, keep it, and strip
 * it from the address bar so it does not linger in history or get copied into a shared link.
 */
function captureAccessToken(): string {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get("token")?.trim();

  if (fromUrl) {
    localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, fromUrl);
    url.searchParams.delete("token");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    return fromUrl;
  }

  return localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)?.trim() || "";
}

let accessToken = captureAccessToken();

export function hasAccessToken(): boolean {
  return Boolean(accessToken);
}

/** The browser helper posts the captured session straight to the API, so it needs the token too. */
export function getAccessToken(): string {
  return accessToken;
}

function withAuthHeaders(init: HeadersInit = {}): Headers {
  const headers = new Headers(init);
  headers.set("Accept", "application/json");
  if (accessToken) headers.set(ACCESS_TOKEN_HEADER, accessToken);
  return headers;
}

async function readApiResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) {
    // A stale token is worse than none: it would keep failing silently on every request.
    accessToken = "";
    localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    throw new Error(body.error || "This OpenTune server needs an access token. Reopen it using the link the server printed on startup.");
  }
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}

export async function apiGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${apiBase}${path}`, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });

  return readApiResponse<T>(await fetch(url, { headers: withAuthHeaders() }));
}

async function apiSend<T>(path: string, init: RequestInit): Promise<T> {
  const url = new URL(`${apiBase}${path}`, window.location.origin);
  const headers = withAuthHeaders(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");

  return readApiResponse<T>(await fetch(url, { ...init, headers }));
}

export function loadAuthStatus(): Promise<AuthStatusDto> {
  return apiGet<AuthStatusDto>("/api/auth/status");
}

export function saveAuthSession(session: AuthSessionRequestDto): Promise<AuthStatusDto> {
  return apiSend<AuthStatusDto>("/api/auth/session", {
    method: "POST",
    body: JSON.stringify(session),
  });
}

export function clearAuthSession(): Promise<AuthStatusDto> {
  return apiSend<AuthStatusDto>("/api/auth/session", { method: "DELETE" });
}

export function startAuthPairing(): Promise<PairingStartResponseDto> {
  return apiSend<PairingStartResponseDto>("/api/auth/pairing/start", { method: "POST" });
}

export function loadAuthPairingStatus(code: string): Promise<PairingStatusResponseDto> {
  return apiGet<PairingStatusResponseDto>("/api/auth/pairing/status", { code });
}

export function colorSetFromId(id: string): Pick<Track, "colorA" | "colorB" | "colorC"> {
  let hash = 0;
  for (const char of id) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  return {
    colorA: `hsl(${hue} 72% 66%)`,
    colorB: `hsl(${(hue + 42) % 360} 54% 34%)`,
    colorC: `hsl(${(hue + 18) % 360} 84% 88%)`,
  };
}

export function apiItemToTrack(item: WebItemDto): Track {
  const itemType = item.type ? item.type[0].toUpperCase() + item.type.slice(1) : "Song";
  const firstArtistWithId = item.artists?.find((artist) => artist.id);
  const artists = item.artists?.length
    ? item.artists.map((artist) => artist.name).filter(Boolean).join(", ")
    : item.type === "artist" ? "Artist" : item.author?.name || itemType || "YouTube Music";
  const album = item.type === "artist"
    ? item.monthlyListenerCountText || item.subscriberCountText || "Artist"
    : item.album?.title || item.songCountText || itemType || "YouTube Music";

  return {
    id: item.id,
    title: item.title,
    artist: artists,
    album,
    duration: item.duration || 0,
    mood: "Online",
    type: itemType,
    thumbnail: item.thumbnail,
    explicit: Boolean(item.explicit),
    source: item.type === "song" ? "youtube" : "youtube-browse",
    playable: item.type === "song",
    lyrics: [],
    browseId: item.browseId || (item.type === "artist" ? item.id : undefined),
    playlistId: item.playlistId,
    artistId: firstArtistWithId?.id || (item.type === "artist" ? item.id : item.author?.id),
    albumId: item.album?.id || (item.type === "album" ? item.browseId || item.id : undefined),
    ...colorSetFromId(item.id || item.title || "opentune"),
  };
}

export function normalizeSearchItems(response: SearchResultsDto): WebItemDto[] {
  if (Array.isArray(response.items)) return response.items;
  if (Array.isArray(response.summaries)) return response.summaries.flatMap((summary) => summary.items || []);
  return [];
}

export async function loadHomeData(mergeTrack: (track: Track) => Track, params = ""): Promise<{ chips: HomeChip[]; sections: HomeSection[] }> {
  const home = await apiGet<HomeResponseDto>("/api/home", params ? { params } : {});
  const chips = (home.chips || [])
    .map((chip) => ({ title: chip.title, params: chip.endpoint?.params }))
    .filter((chip) => chip.title && chip.params);
  const sections = (home.sections || [])
    .map((section) => {
      const trackIds = (section.items || [])
        .filter((item) => item.id && item.title)
        .map(apiItemToTrack)
        .map((track) => mergeTrack(track).id);
      return { title: section.title, trackIds };
    })
    .filter((section) => section.trackIds.length);

  return { chips, sections };
}

export async function loadExploreData(mergeTrack: (track: Track) => Track): Promise<ExploreResponseDto & { newReleaseIds: string[] }> {
  const explore = await apiGet<ExploreResponseDto>("/api/explore");
  const newReleaseIds = (explore.newReleaseAlbums || [])
    .filter((item) => item.id && item.title)
    .map(apiItemToTrack)
    .map((track) => mergeTrack(track).id);
  return { ...explore, newReleaseIds };
}

export async function loadBrowseData(browseId: string, params: string | undefined, mergeTrack: (track: Track) => Track): Promise<{ title: string; thumbnail?: string; trackIds: string[] }> {
  const browse = await apiGet<BrowseResponseDto>("/api/browse", {
    browseId,
    params: params || "",
  });
  const trackIds = (browse.sections || [])
    .flatMap((section) => section.items || [])
    .filter((item) => item.id && item.title)
    .map(apiItemToTrack)
    .map((track) => mergeTrack(track).id);
  return {
    title: browse.title || "YouTube Music",
    thumbnail: browse.thumbnail,
    trackIds,
  };
}

export async function loadLibraryItems(filter: string, mergeTrack: (track: Track) => Track): Promise<string[]> {
  const library = await apiGet<LibraryResponseDto>("/api/library", { filter });
  return (library.items || [])
    .filter((item) => item.id && item.title)
    .map(apiItemToTrack)
    .map((track) => mergeTrack(track).id);
}

/**
 * A pin carries its own title, artist and artwork, so it renders on a cold start.
 *
 * Android resolves pinned ids against the songs already in its database. The web app has no database
 * to resolve against -- a song is only known once some page has loaded it -- so a pin that stored an
 * id alone would show up as an empty tile until the listener happened to browse past that song again.
 */
function speedDialItemToTrack(item: SpeedDialItemDto): Track {
  return {
    id: item.id,
    title: item.title,
    artist: item.artist || "YouTube Music",
    album: "Song",
    duration: item.duration || 0,
    mood: "Online",
    type: "Song",
    thumbnail: item.thumbnail,
    explicit: false,
    source: "youtube",
    playable: true,
    lyrics: [],
    ...colorSetFromId(item.id || item.title || "opentune"),
  };
}

function trackToSpeedDialItem(track: Track): SpeedDialItemDto {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    thumbnail: track.thumbnail,
    duration: track.duration || undefined,
  };
}

export async function loadSpeedDial(mergeTrack: (track: Track) => Track): Promise<string[]> {
  const speedDial = await apiGet<SpeedDialResponseDto>("/api/speed-dial");
  return (speedDial.items || [])
    .filter((item) => item.id && item.title)
    .map(speedDialItemToTrack)
    .map((track) => mergeTrack(track).id);
}

/**
 * Writes the whole pin list, which is also how a song is unpinned.
 *
 * The server answers with the list it actually stored -- deduplicated and capped, as Android caps it
 * -- so the caller adopts that rather than assuming the write landed exactly as sent.
 */
export async function saveSpeedDial(pins: Track[], mergeTrack: (track: Track) => Track): Promise<string[]> {
  const saved = await apiSend<SpeedDialResponseDto>("/api/speed-dial", {
    method: "PUT",
    body: JSON.stringify({ items: pins.map(trackToSpeedDialItem) }),
  });
  return (saved.items || [])
    .filter((item) => item.id && item.title)
    .map(speedDialItemToTrack)
    .map((track) => mergeTrack(track).id);
}

export async function setRemoteLike(videoId: string, liked: boolean): Promise<void> {
  await apiSend("/api/library/like", {
    method: "POST",
    body: JSON.stringify({ videoId, liked }),
  });
}

export async function searchSongs(query: string, mergeTrack: (track: Track) => Track): Promise<string[]> {
  const results = await apiGet<SearchResultsDto>("/api/search", { q: query, filter: "songs" });
  return normalizeSearchItems(results)
    .filter((item) => item.id && item.title)
    .map(apiItemToTrack)
    .map((track) => mergeTrack(track).id);
}

export async function searchSuggestions(query: string): Promise<string[]> {
  const suggestions = await apiGet<SearchSuggestionsDto>("/api/search/suggestions", { q: query });
  return suggestions.queries.slice(0, 5);
}

export function playerMetadata(videoId: string): Promise<PlayerResponseDto> {
  return apiGet<PlayerResponseDto>(`/api/player/${encodeURIComponent(videoId)}`);
}

/**
 * The URL an <audio> element plays: the server's stream proxy, not the raw googlevideo URL.
 *
 * YouTube signs each stream URL to the IP that asked for it, and that is the server, not the browser
 * -- so the browser must fetch through the server or it plays only when the two share an address. An
 * <audio> element cannot send headers, so the access token rides in the query string, the same way
 * the startup link carries it.
 */
export function streamUrl(videoId: string, itag: number): string {
  const url = new URL(`${apiBase}/api/stream/${encodeURIComponent(videoId)}`, window.location.origin);
  url.searchParams.set("itag", String(itag));
  if (accessToken) url.searchParams.set("token", accessToken);
  return url.toString();
}

export async function loadDetail(kind: "album" | "playlist", id: string, mergeTrack: (track: Track) => Track): Promise<{ item: Track; trackIds: string[] }> {
  const path = kind === "album" ? `/api/album/${encodeURIComponent(id)}` : `/api/playlist/${encodeURIComponent(id)}`;
  const detail = await apiGet<DetailResponseDto>(path);
  const item = mergeTrack(apiItemToTrack(detail.item));
  const trackIds = detail.tracks
    .filter((track) => track.id && track.title)
    .map(apiItemToTrack)
    .map((track) => mergeTrack(track).id);
  return { item, trackIds };
}

export async function loadNextQueue(videoId: string, mergeTrack: (track: Track) => Track): Promise<{ title: string; trackIds: string[] }> {
  const next = await apiGet<NextResponseDto>(`/api/next/${encodeURIComponent(videoId)}`);
  const trackIds = (next.items || [])
    .filter((item) => item.id && item.title)
    .map(apiItemToTrack)
    .map((track) => mergeTrack(track).id);
  return {
    title: next.title || "Up next",
    trackIds,
  };
}

export async function loadLyrics(track: Track): Promise<LyricsResponseDto> {
  return apiGet<LyricsResponseDto>(`/api/lyrics/${encodeURIComponent(track.id)}`, {
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: String(track.duration || -1),
  });
}
