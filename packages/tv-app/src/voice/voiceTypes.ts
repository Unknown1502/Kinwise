/** Plays one spoken line at a time from a URL (implemented per platform in player*.ts). */
export interface VoicePlayer {
  /** Resolves when the line has finished (or failed); never rejects. */
  play(url: string): Promise<void>;
  stop(): void;
}
