import { isLength, isSort, type LengthKey, type SortKey } from "./discover";
type SP = Record<string, string | string[] | undefined>;
export type DiscoverFilters = { topics: string[]; length: LengthKey | null; sort: SortKey; cursor: number; channel: string; maxMinutes: number | null };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
export function parseDiscoverFilters(sp: SP): DiscoverFilters {
  const raw = sp.topic === undefined ? [] : Array.isArray(sp.topic) ? sp.topic : [sp.topic];
  const length = one(sp.len), sort = one(sp.sort), page = Number(one(sp.page)), minutes = Number(one(sp.maxMinutes));
  return {
    topics: [...new Set(raw.map((t) => t.trim()).filter(Boolean))].slice(0, 20),
    length: isLength(length) ? length : null, sort: isSort(sort) ? sort : "top",
    cursor: Number.isSafeInteger(page) && page >= 0 ? Math.min(page, 400) : 0,
    channel: one(sp.channel).trim().slice(0, 120),
    maxMinutes: Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440 ? minutes : null,
  };
}
export function discoverHref(base: string, filters: DiscoverFilters, next: Partial<DiscoverFilters> = {}): string {
  const value = { ...filters, cursor: 0, ...next };
  const q = new URLSearchParams();
  for (const topic of value.topics) q.append("topic", topic);
  if (value.length) q.set("len", value.length);
  if (value.sort !== "top") q.set("sort", value.sort);
  if (value.channel) q.set("channel", value.channel);
  if (value.maxMinutes !== null) q.set("maxMinutes", String(value.maxMinutes));
  if (value.cursor) q.set("page", String(value.cursor));
  return q.size ? `${base}?${q}` : base;
}
