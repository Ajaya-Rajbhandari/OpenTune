import { playerMetadata } from "./api";
import type { Track } from "./types";

interface StreamSource {
  url: string;
  expiresAt: number;
}

interface AudioPlayerState {
  readonly trackId?: string;
  readonly isPlaying?: boolean;
  readonly isBuffering?: boolean;
  readonly position?: number;
  readonly duration?: number;
}

export class AudioPlayer {
  readonly audio = new Audio();
  private readonly streamCache = new Map<string, StreamSource>();
  private playbackToken = 0;

  constructor(
    private readonly onState: (state: AudioPlayerState) => void,
    private readonly onEnded: () => void,
    private readonly onError: (message: string, trackId?: string) => void,
  ) {
    this.audio.preload = "metadata";
    this.audio.addEventListener("timeupdate", () => this.emitState({ position: this.audio.currentTime || 0 }));
    this.audio.addEventListener("durationchange", () => {
      if (Number.isFinite(this.audio.duration)) this.emitState({ duration: Math.round(this.audio.duration) });
    });
    this.audio.addEventListener("play", () => this.emitState({ isBuffering: true }));
    this.audio.addEventListener("waiting", () => this.emitState({ isBuffering: true }));
    this.audio.addEventListener("playing", () => {
      this.emitState({ isPlaying: true, isBuffering: false });
    });
    this.audio.addEventListener("pause", () => this.emitState({ isPlaying: false, isBuffering: false }));
    this.audio.addEventListener("ended", this.onEnded);
    this.audio.addEventListener("error", () => {
      this.emitState({ isPlaying: false, isBuffering: false });
      this.onError("Playback failed for this stream", this.activeTrackId);
    });
  }

  isRemoteTrack(track: Track): boolean {
    return track.source === "youtube" && track.playable !== false;
  }

  stop(): void {
    this.playbackToken += 1;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.removeAttribute("data-track-id");
    this.audio.load();
  }

  async play(track: Track): Promise<void> {
    try {
      await this.attempt(track);
    } catch (error) {
      // A stream URL is signed and time-limited, and the one we cached may have been resolved
      // under a session that has since gone away. Retrying the same dead URL forever is what turned
      // a recoverable hiccup into "no supported source" on every track, so throw the cached URL
      // away and resolve a fresh one before giving up.
      if (!this.streamCache.delete(track.id)) throw error;
      await this.attempt(track);
    }
  }

  private async attempt(track: Track): Promise<void> {
    const token = ++this.playbackToken;
    const source = await this.resolveSource(track);
    if (token !== this.playbackToken) return;

    if (this.audio.getAttribute("data-track-id") !== track.id || this.audio.src !== source.url) {
      this.audio.setAttribute("data-track-id", track.id);
      this.audio.src = source.url;
    }
    if (token !== this.playbackToken) return;

    await this.audio.play();
  }

  async toggle(track: Track): Promise<void> {
    if (this.audio.getAttribute("data-track-id") === track.id && this.audio.src) {
      if (this.audio.paused) {
        await this.audio.play();
      } else {
        this.audio.pause();
      }
      return;
    }

    await this.play(track);
  }

  seek(seconds: number): void {
    if (this.audio.src) this.audio.currentTime = seconds;
  }

  private async resolveSource(track: Track): Promise<StreamSource> {
    const cached = this.streamCache.get(track.id);
    if (cached && cached.expiresAt > Date.now()) return cached;

    const player = await playerMetadata(track.id);
    if (player.playabilityStatus !== "OK") {
      throw new Error(player.playabilityReason || `Playback unavailable: ${player.playabilityStatus}`);
    }

    track.duration = player.durationSeconds || track.duration;
    track.thumbnail = player.thumbnail || track.thumbnail;

    // Only formats the browser has actually said it can decode. The old fallback took the first
    // format with a URL even when canPlayType() had just rejected it, which hands the audio element
    // a codec it cannot play and reports it as a stream failure.
    const selectedFormat = player.formats.find((format) => format.url && this.audio.canPlayType(format.mimeType));
    if (!selectedFormat?.url) throw new Error("No browser-playable stream URL returned");

    const source = {
      url: selectedFormat.url,
      expiresAt: Date.now() + Math.max(60, (player.expiresInSeconds || 1800) - 60) * 1000,
    };
    this.streamCache.set(track.id, source);
    return source;
  }

  private get activeTrackId(): string | undefined {
    return this.audio.getAttribute("data-track-id") || undefined;
  }

  private emitState(state: Omit<AudioPlayerState, "trackId">): void {
    this.onState({ ...state, trackId: this.activeTrackId });
  }
}
