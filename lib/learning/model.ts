export const WATCHED_FRACTION = 0.9;
export const MAX_POSITION_S = 7 * 24 * 3600;
export type LearningStatus = "in_progress" | "watched" | "skipped";
export type LearningState = { saved: boolean; status: LearningStatus | null; positionS: number };
export const EMPTY_LEARNING: LearningState = { saved: false, status: null, positionS: 0 };

export type LearningVideo = {
  id: string;
  videoId: string;
  title: string;
  creatorName: string | null;
  thumbnailUrl: string | null;
  durationS: number | null;
};
export type LearningEntry = LearningVideo & LearningState & { updatedAt: string };

export function playbackPosition(positionS: number, durationS: number | null): number {
  const maximum = durationS && durationS > 0 ? durationS : MAX_POSITION_S;
  return Math.min(Math.floor(positionS), maximum, MAX_POSITION_S);
}

export function hasFinished(positionS: number, durationS: number | null, ended = false): boolean {
  return ended || (durationS !== null && durationS > 0 && positionS / durationS >= WATCHED_FRACTION);
}
