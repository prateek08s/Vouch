export const RESOURCE_KINDS = { code: "Code", notebook: "Notebook", paper: "Paper", reading: "Reading", roadmap: "Roadmap", other: "Other" } as const;
export type ResourceKind = keyof typeof RESOURCE_KINDS;
export type LessonResource = { id: string; list_id: string; resource_id: string; kind: ResourceKind; title: string; url: string };
export const LESSON_RESOURCE_MAX = 8;
export function resourceUrl(raw: string): string | null {
  if (raw.length > 2048) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname) return null;
    return url.href.length <= 2048 ? url.href : null;
  } catch { return null; }
}
