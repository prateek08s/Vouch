/**
 * YouTube URL parsing.
 *
 * Every Vouch starts with a pasted link, so this must accept every shape real
 * people paste and reject anything that only looks like YouTube.
 */

export type ParseError = "empty" | "not_youtube" | "no_video_id" | "invalid_video_id";

export type ParsedYouTubeUrl =
  | { ok: true; videoId: string; isShort: boolean; startSeconds: number | null }
  | { ok: false; error: ParseError };

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

// Exact hostnames only. Suffix matching would let youtube.com.evil.example through.
const LONG_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);
const SHORT_HOSTS = new Set(["youtu.be", "www.youtu.be"]);

// Path prefixes on the long hosts that carry the ID as the next segment.
const PATH_ID_PREFIXES = new Set(["embed", "v", "live", "shorts"]);

export function parseYouTubeUrl(input: string): ParsedYouTubeUrl {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "empty" };

  const url = toUrl(raw);
  if (!url) return { ok: false, error: "not_youtube" };

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  let candidate: string | null = null;
  let isShort = false;

  if (SHORT_HOSTS.has(host)) {
    candidate = segments[0] ?? null;
  } else if (LONG_HOSTS.has(host)) {
    const [first, second] = segments;
    if (first === "watch") {
      candidate = url.searchParams.get("v");
    } else if (first && PATH_ID_PREFIXES.has(first)) {
      candidate = second ?? null;
      isShort = first === "shorts";
    }
  } else {
    return { ok: false, error: "not_youtube" };
  }

  if (candidate === null || candidate === "") return { ok: false, error: "no_video_id" };
  if (!VIDEO_ID.test(candidate)) return { ok: false, error: "invalid_video_id" };

  return {
    ok: true,
    videoId: candidate,
    isShort,
    startSeconds: parseStart(url.searchParams.get("t") ?? url.searchParams.get("start")),
  };
}

export function canonicalYouTubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function toUrl(raw: string): URL | null {
  // Allow scheme-less pastes like "youtube.com/watch?v=...", but never other schemes.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return url;
}

/** Accepts "90", "90s", "1m30s", "1h2m3s". Returns null when absent or unreadable. */
function parseStart(value: string | null): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}
