import { EMPTY_LEARNING, hasFinished, MAX_POSITION_S, playbackPosition, type LearningEntry, type LearningState, type LearningStatus, type LearningVideo } from "./model";
import { parse, readLocal, subscribeLocal, updateLocal } from "./local";

export function browserEntries(): LearningEntry[] {
  const local = parse(readLocal());
  const ids = [...new Set([...Object.keys(local.progress), ...Object.keys(local.saved)])];
  const entries: LearningEntry[] = [];
  for (const id of ids) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) continue;
    const progress = local.progress[id];
    const saved = local.saved[id];
    const title = progress?.title ?? saved?.title;
    const thumbnailUrl = progress?.thumbnailUrl ?? saved?.thumb ?? null;
    if (typeof title !== "string" || (thumbnailUrl !== null && !/^https:\/\/i\.ytimg\.com\//.test(thumbnailUrl))) continue;
    const videoId = progress?.videoId ?? "";
    const positionS = progress?.positionS ?? 0;
    const durationS = progress?.durationS ?? null;
    const savedAt = typeof saved?.at === "number" && Number.isFinite(saved.at) && Math.abs(saved.at) <= 8640000000000000 ? saved.at : 0;
    const updatedAt = progress?.updatedAt ?? new Date(savedAt).toISOString();
    if ((videoId !== "" && !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) ||
        !Number.isFinite(positionS) || positionS < 0 || positionS > MAX_POSITION_S ||
        (durationS !== null && (!Number.isFinite(durationS) || durationS < 0)) ||
        !Number.isFinite(Date.parse(updatedAt))) continue;
    const status = local.watched[id] ? "watched" : progress?.status ?? null;
    if (![null, "in_progress", "watched", "skipped"].includes(status)) continue;
    entries.push({
      id, videoId, title, thumbnailUrl, creatorName: typeof progress?.creatorName === "string" ? progress.creatorName : null,
      durationS, saved: !!saved, status, positionS, updatedAt,
    });
  }
  return entries.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 500);
}

export function browserState(id: string): LearningState {
  const entry = browserEntries().find((item) => item.id === id);
  const local = parse(readLocal());
  return entry ? { saved: entry.saved, status: entry.status, positionS: entry.positionS } :
    { ...EMPTY_LEARNING, status: local.watched[id] ? "watched" : null };
}

export function writeBrowserState(video: LearningVideo, state: LearningState): void {
  updateLocal((local) => {
    const now = Date.now();
    local.progress[video.id] = { ...video, ...state, updatedAt: new Date(now).toISOString() };
    if (state.saved) local.saved[video.id] = { title: video.title, thumb: video.thumbnailUrl, at: local.saved[video.id]?.at ?? now };
    else delete local.saved[video.id];
    if (state.status === "watched") local.watched[video.id] = now;
    else delete local.watched[video.id];
    const progressIds = Object.keys(local.progress).sort((a, b) => (Date.parse(local.progress[b]?.updatedAt) || 0) - (Date.parse(local.progress[a]?.updatedAt) || 0));
    for (const id of progressIds.slice(500)) delete local.progress[id];
  }, true);
}

export type LearningCommand =
  | { action: "save"; saved: boolean }
  | { action: "status"; status: LearningStatus }
  | { action: "playback"; positionS: number; observedAt: number; ended?: boolean };

export function nextLearningState(state: LearningState, command: LearningCommand, durationS: number | null): LearningState {
  if (command.action === "save") return { ...state, saved: command.saved };
  if (command.action === "status") return { ...state, status: command.status, positionS: command.status === "in_progress" ? 0 : state.positionS };
  const position = playbackPosition(command.positionS, durationS);
  return {
    ...state, positionS: position,
    status: state.status === "watched" || state.status === "skipped" ? state.status :
      hasFinished(position, durationS, command.ended) ? "watched" : "in_progress",
  };
}

export const subscribeLearning = subscribeLocal;
