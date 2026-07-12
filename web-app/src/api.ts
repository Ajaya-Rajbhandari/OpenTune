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
  Track,
  WebItemDto,
} from "./types";

const apiBase = import.meta.env.VITE_API_BASE ?? "";

export async function apiGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${apiBase}${path}`, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}

async function apiSend<T>(path: string, init: RequestInit): Promise<T> {
  const url = new URL(`${apiBase}${path}`, window.location.origin);
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(url, {
    ...init,
    headers,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
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
