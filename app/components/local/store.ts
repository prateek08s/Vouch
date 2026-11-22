"use client";
import { useMemo, useSyncExternalStore } from "react";
import { EMPTY_LOCAL, parse, readLocal, subscribeLocal, type LocalState } from "@/lib/learning/local";

export { exportLocal, parse, updateLocal } from "@/lib/learning/local";
export type { LocalState, SavedItem } from "@/lib/learning/local";

export function useLocal(): LocalState {
  const raw = useSyncExternalStore(subscribeLocal, readLocal, () => EMPTY_LOCAL);
  return useMemo(() => parse(raw), [raw]);
}
