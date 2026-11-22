import type { LearningEntry } from "./model";

export type SavedItem = { title: string; thumb: string | null; at: number };
export type LocalState = {
  saved: Record<string, SavedItem>;
  watched: Record<string, number>;
  ratings: Record<string, boolean>;
  hideWatched: boolean;
  progress: Record<string, LearningEntry>;
};
const KEY = "vouch.v1";
const EVENT = "vouch-local";
export const EMPTY_LOCAL = "{}";

export function readLocal(): string {
  try { return localStorage.getItem(KEY) ?? EMPTY_LOCAL; } catch { return EMPTY_LOCAL; }
}

export function parse(raw: string): LocalState {
  try {
    const value = JSON.parse(raw);
    const record = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
    return {
      saved: record(value.saved) ? value.saved : {},
      watched: record(value.watched) ? value.watched : {},
      ratings: record(value.ratings) ? value.ratings : {},
      hideWatched: value.hideWatched === true,
      progress: record(value.progress) ? value.progress : {},
    };
  } catch { return { saved: {}, watched: {}, ratings: {}, hideWatched: false, progress: {} }; }
}

export function subscribeLocal(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(EVENT, callback);
  };
}

export function updateLocal(fn: (state: LocalState) => void, strict = false): void {
  const state = parse(readLocal());
  fn(state);
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (error) { if (strict) throw error; }
  window.dispatchEvent(new Event(EVENT));
}

export function exportLocal(): string {
  return JSON.stringify(parse(readLocal()), null, 2);
}
