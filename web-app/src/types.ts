export type Route = "home" | "search" | "explore" | "library" | "detail" | "now";

export type LoadStatus = "idle" | "loading" | "ready" | "error";

export type LyricsLine = [number, string];

export interface LyricsCalibration {
  anchorPlaybackMs: number;
  anchorLyricMs: number;
  rate: number;
  lastPlaybackMs: number;
  lastLyricMs: number;
}

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
  lyricsSource?: string;
  lyricsMatchDuration?: number;
  /**
   * How far the lyrics are likely to run ahead, in ms, because they were timed against a shorter
   * recording than the one playing -- an album cut against an official video with an intro.
   */
  lyricsIntroDriftMs?: number;
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

export interface PairingStartResponseDto {
  code: string;
  expiresAt: number;
}

export interface PairingStatusResponseDto {
  state: "pending" | "paired" | "expired" | "missing";
  expiresAt?: number;
  auth?: AuthStatusDto;
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
  /**
   * Songs pinned to Speed dial, in the order they were pinned.
   *
   * They live on the server rather than in this browser: it is the one arrangement the listener makes
   * by hand, and it should be the same list whether they open OpenTune on the laptop or the phone.
   */
  speedDialIds: string[];
  currentTrackId: string;
  /** Upcoming tracks, in the order they will play. Already shuffled when shuffle is on. */
  queue: string[];
  /** The tracks that were actually played, oldest first, so "previous" can retrace real steps. */
  history: string[];
  /** The context that was started, in its natural order: what shuffle draws from and unshuffle restores. */
  queueSource: string[];
  /**
   * Whether the queue may be continued with YouTube's autoplay suggestions when it runs out.
   *
   * True for a track played on its own, false for a list the user chose: a playlist is the queue and
   * must not turn into a radio station behind their back.
   */
  autoplayRadio: boolean;
  favorites: Set<string>;
  downloaded: Set<string>;
  isPlaying: boolean;
  position: number;
  loadingTrackId: string | null;
  playbackError: string;
  shuffle: boolean;
  /**
   * Whether shuffle survives the start of a new queue.
   *
   * Android turns shuffle off every time a queue starts unless this is set (PermanentShuffleKey), so
   * shuffling one playlist does not silently shuffle everything played after it.
   */
  permanentShuffle: boolean;
  repeatMode: "off" | "all" | "one";
  playerPage: "lyrics" | "queue";
  nowLyricsOpen: boolean;
  nowQueueOpen: boolean;
  lyricsFullscreen: boolean;
  lyricsMode: "focus" | "full" | "compact";
  lyricsOffsetMs: number;
  lyricsOffsetsMs: Record<string, number>;
  lyricsCalibrations: Record<string, LyricsCalibration>;
  auth: AuthUiState;
  accountOpen: boolean;
  accountSaving: boolean;
  accountError: string;
  androidPairingPending: boolean;
  androidPairingCode: string;
  androidPairingExpiresAt: number;
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

/** A pinned song, stored whole so a Speed dial tile can be drawn without asking YouTube for it. */
export interface SpeedDialItemDto {
  id: string;
  title: string;
  artist?: string;
  thumbnail?: string;
  duration?: number;
}

export interface SpeedDialResponseDto {
  items: SpeedDialItemDto[];
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
  /** Duration of the recording the lyrics were timed against, when the provider reported it. */
  lyricsDurationSeconds?: number;
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
