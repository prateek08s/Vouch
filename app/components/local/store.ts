"use client";
import { useMemo, useSyncExternalStore } from "react";

/**
 * Saved, watched and Worth-it answers kept in this browser only (localStorage), so they work
 * without an account. Nothing here is uploaded, except a signed-out Worth-it answer, which is
 * counted anonymously for the experiment (see the privacy page).
 */
export type SavedItem = { title: string; thumb: string | null; at: number };
export type LocalState = {
  saved: Record<string, SavedItem>;
  watched: Record<string, number>;
  ratings: Record<string, boolean>;
  hideWatched: boolean;
};

const KEY = "vouch.v1";
const EVENT = "vouch-local";
const EMPTY = "{}";

function read(): string {
  try { return localStorage.getItem(KEY) ?? EMPTY; } catch { return EMPTY; }
}

export function parse(raw: string): LocalState {
  try {
    const v = JSON.parse(raw) as Partial<LocalState>;
    return { saved: v.saved ?? {}, watched: v.watched ?? {}, ratings: v.ratings ?? {}, hideWatched: v.hideWatched === true };
  } catch {
    return { saved: {}, watched: {}, ratings: {}, hideWatched: false };
  }
}

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}

export function useLocal(): LocalState {
  const raw = useSyncExternalStore(subscribe, read, () => EMPTY);
  return useMemo(() => parse(raw), [raw]);
}

export function updateLocal(fn: (s: LocalState) => void): void {
  const s = parse(read());
  fn(s);
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage can be full or blocked (private windows); the action just doesn't stick.
  }
  window.dispatchEvent(new Event(EVENT));
}

/** A file of this browser's saved and watched videos, to back up or move. */
export function exportLocal(): string {
  return JSON.stringify(parse(read()), null, 2);
}
