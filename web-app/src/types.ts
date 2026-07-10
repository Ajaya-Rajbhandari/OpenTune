export type Route = "home" | "search" | "explore" | "library" | "detail" | "now";

export type LoadStatus = "idle" | "loading" | "ready" | "error";

export type LyricsLine = [number, string];

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  mood: string;
  type: string;
  colorA: string;
  colorB: string;
  colorC: string;
  lyrics: LyricsLine[];
  thumbnail?: string;
  explicit?: boolean;
  playable?: boolean;
  source?: "demo" | "youtube" | "youtube-browse";
  browseId?: string;
  playlistId?: string;
  lyricsStatus?: LoadStatus;
  lyricsError?: string;
  lyricsSynced?: boolean;
  artistId?: string;
  albumId?: string;
}

export interface HomeSection {
  title: string;
  trackIds: string[];
}

export interface HomeChip {
  title: string;
  params?: string;
}

export interface ExploreMoodDto {
  title: string;
  color: string;
  endpoint?: { browseId: string; params?: string };
}

export interface AuthAccountDto {
  name: string;
  email?: string;
  channelHandle?: string;
  thumbnailUrl?: string;
}

export interface AuthStatusDto {
  loggedIn: boolean;
  hasCookie: boolean;
  hasVisitorData: boolean;
  hasDataSyncId: boolean;
  hasPoToken: boolean;
  useLoginForBrowse: boolean;
  account?: AuthAccountDto;
  error?: string;
}

export interface AuthSessionRequestDto {
  cookie: string;
  visitorData?: string;
  dataSyncId?: string;
  poToken?: string;
}

export interface AuthUiState extends AuthStatusDto {
  status: LoadStatus;
}

export interface AppState {
  route: Route;
  homeFilter: string;
  libraryFilter: string;
  query: string;
  search: {
    query: string;
    status: LoadStatus;
    suggestions: string[];
    results: string[];
    error: string;
    requestId: number;
  };
  home: {
    status: LoadStatus;
    chips: HomeChip[];
    activeChipTitle: string;
    activeChipParams: string;
    sections: HomeSection[];
    trackIds: string[];
    error: string;
  };
  detail: {
    status: LoadStatus;
    kind: "album" | "playlist" | "artist" | "browse" | "";
    itemId: string;
    title: string;
    subtitle: string;
    thumbnail?: string;
    trackIds: string[];
    error: string;
  };
  next: {
    status: LoadStatus;
    title: string;
    error: string;
    requestId: number;
  };
  explore: {
    status: LoadStatus;
    newReleaseIds: string[];
    moods: ExploreMoodDto[];
    error: string;
  };
  library: {
    status: LoadStatus;
    activeFilter: string;
    itemIdsByFilter: Record<string, string[]>;
    error: string;
  };
  currentTrackId: string;
  queue: string[];
  favorites: Set<string>;
  downloaded: Set<string>;
  isPlaying: boolean;
  position: number;
  loadingTrackId: string | null;
  playbackError: string;
  shuffle: boolean;
  repeatMode: "off" | "all" | "one";
  playerPage: "lyrics" | "queue";
  nowLyricsOpen: boolean;
  nowQueueOpen: boolean;
  lyricsFullscreen: boolean;
  lyricsMode: "focus" | "full" | "compact";
  lyricsOffset: number;
  auth: AuthUiState;
  accountOpen: boolean;
  accountSaving: boolean;
  accountError: string;
  extensionLoginPending: boolean;
  extensionLoginStarted: boolean;
  extensionInstallVisible: boolean;
}

export interface WebArtistDto {
  id?: string;
  name: string;
}

export interface WebItemDto {
  type: string;
  id: string;
  title: string;
  thumbnail?: string;
  explicit?: boolean;
  artists?: WebArtistDto[];
  album?: { id: string; title: string };
  duration?: number;
  author?: WebArtistDto;
  songCountText?: string;
  browseId?: string;
  playlistId?: string;
  subscriberCountText?: string;
  monthlyListenerCountText?: string;
}

export interface HomeResponseDto {
  chips?: Array<{
    title: string;
    endpoint?: { browseId: string; params?: string };
  }>;
  sections: Array<{
    title: string;
    items: WebItemDto[];
  }>;
}

export interface ExploreResponseDto {
  newReleaseAlbums: WebItemDto[];
  moods: ExploreMoodDto[];
}

export interface BrowseResponseDto {
  title?: string;
  thumbnail?: string;
  sections: Array<{ title?: string; items: WebItemDto[] }>;
}

export interface LibraryResponseDto {
  filter: string;
  items: WebItemDto[];
}

export interface SearchResultsDto {
  items?: WebItemDto[];
  summaries?: Array<{ items: WebItemDto[] }>;
}

export interface SearchSuggestionsDto {
  queries: string[];
}

export interface DetailResponseDto {
  kind: "album" | "playlist";
  item: WebItemDto;
  tracks: WebItemDto[];
  continuation?: string;
}

export interface NextResponseDto {
  title?: string;
  items: WebItemDto[];
  currentIndex?: number;
  continuation?: string;
  lyricsEndpoint?: { browseId: string; params?: string };
  relatedEndpoint?: { browseId: string; params?: string };
}

export interface LyricsResponseDto {
  source: string;
  synced: boolean;
  text: string;
  lines: string[];
  entries: Array<{ time: number; text: string }>;
}

export interface PlayerFormatDto {
  mimeType: string;
  url?: string;
}

export interface PlayerResponseDto {
  videoId: string;
  title?: string;
  author?: string;
  durationSeconds?: number;
  thumbnail?: string;
  playabilityStatus: string;
  playabilityReason?: string;
  expiresInSeconds?: number;
  formats: PlayerFormatDto[];
}
