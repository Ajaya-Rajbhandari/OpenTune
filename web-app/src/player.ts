import { playerMetadata } from "./api";
import type { PlayerFormatDto, Track } from "./types";

interface StreamSource {
  /** Every format this browser might decode, best first. */
  urls: string[];
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
  private suppressErrors = false;

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
      // While a play attempt is in flight, a failing format is expected: the attempt loop is walking
      // the candidates and will either recover or surface the real error itself. Reporting here too
      // just fires a toast per discarded format.
      if (this.suppressErrors) return;
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
    // Clearing the src and reloading makes the element fire an error, which the error handler then
    // reports as a second, invented playback failure. Every real failure came through as a pair of
    // toasts because of this, the second one describing the cleanup rather than the cause.
    this.suppressErrors = true;
    this.audio.removeAttribute("src");
    this.audio.removeAttribute("data-track-id");
    this.audio.load();
    this.suppressErrors = false;
  }

  async play(track: Track): Promise<void> {
    try {
      await this.attempt(track);
    } catch (error) {
      // A stream URL is signed and time-limited, and the cached one may have been resolved under a
      // session that has since gone away. Replaying a dead URL forever is what turned a recoverable
      // failure into a permanently unplayable track, so drop it and resolve once more.
      if (!this.streamCache.delete(track.id)) throw error;
      await this.attempt(track);
    }
  }

  private async attempt(track: Track): Promise<void> {
    const token = ++this.playbackToken;
    const source = await this.resolveSource(track);
    if (token !== this.playbackToken) return;

    let lastError: unknown;
    this.suppressErrors = true;
    try {
      for (const url of source.urls) {
        if (token !== this.playbackToken) return;

        this.audio.setAttribute("data-track-id", track.id);
        this.audio.src = url;

        try {
          await this.audio.play();
          return;
        } catch (error) {
          // The browser said it could decode this and could not. Move on to the next format rather
          // than declaring the whole track unplayable.
          lastError = error;
        }
      }
    } finally {
      this.suppressErrors = false;
    }

    throw lastError ?? new Error("No browser-playable stream URL returned");
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

  /**
   * Ranks a format by how likely this browser is to actually decode it.
   *
   * canPlayType() cannot be trusted on its own. Safari answers "maybe" for WebM/Opus and then fails
   * to decode it, and YouTube usually ranks Opus above AAC on bitrate -- so picking the top format
   * the browser "supports" silently chose an unplayable one for most tracks in Safari, while working
   * in Chrome. AAC in MP4 is the one audio format every browser really plays, so prefer it, and
   * treat canPlayType() as a tie-breaker rather than the answer.
   */
  private formatRank(format: PlayerFormatDto): number {
    const verdict = this.audio.canPlayType(format.mimeType);
    if (verdict === "") return -1;

    const universallySupported = /audio\/mp4|mp4a/.test(format.mimeType) ? 2 : 0;
    return universallySupported + (verdict === "probably" ? 1 : 0);
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

    // Keep every candidate, best first, rather than betting the track on one guess. If the browser
    // then fails to decode the format it claimed to support, there is something left to fall back to.
    const urls = player.formats
      .filter((format) => format.url && this.formatRank(format) >= 0)
      .sort((a, b) => this.formatRank(b) - this.formatRank(a))
      .map((format) => format.url as string);

    if (!urls.length) throw new Error("No browser-playable stream URL returned");

    const source = {
      urls,
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
