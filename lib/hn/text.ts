import { parseYouTubeUrl } from "@/lib/youtube/parse";

/**
 * Hacker News stores comment text as a small HTML subset: <p> between paragraphs,
 * <a href> for every URL (display text may be truncated with "..."), <i>, <pre><code>,
 * and entities such as &#x27; and &#x2F;. This turns it into plain text and finds the
 * YouTube videos it links to.
 */

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

/** HN comment HTML to plain text. Links become their full href, paragraphs a blank line. */
export function hnHtmlToText(html: string): string {
  const text = html
    // Entities are decoded once, at the end, so an href keeps its encoding until then.
    .replace(/<a\s[^>]*?href="([^"]*)"[^>]*>[\s\S]*?<\/a>/gi, (_m, href: string) => href)
    .replace(/<p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type YouTubeLink = { videoId: string; url: string; isShort: boolean; startSeconds: number | null };

// Candidate URLs only; parseYouTubeUrl decides what is really a video link.
const URLISH = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:youtube\.com|youtu\.be|youtube-nocookie\.com)\/[^\s<>"'`]*/gi;

function trimTrailing(url: string): string {
  let u = url.replace(/[.,;:!?*]+$/, "");
  // Drop closing brackets that the URL never opened: "(see https://youtu.be/x)".
  for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]] as const) {
    while (u.endsWith(close) && u.split(open).length <= u.split(close).length - 1) {
      u = u.slice(0, -1).replace(/[.,;:!?*]+$/, "");
    }
  }
  return u;
}

/** Distinct YouTube videos linked from a comment, in the order they first appear. */
export function extractYouTubeLinks(textOrHtml: string, opts: { isHtml?: boolean } = {}): YouTubeLink[] {
  const text = opts.isHtml === false ? textOrHtml : hnHtmlToText(textOrHtml);
  const seen = new Set<string>();
  const out: YouTubeLink[] = [];
  for (const m of text.matchAll(URLISH)) {
    // Skip matches glued to a preceding word, e.g. "notyoutube.com" is caught by the host check,
    // but "evil.com/?u=youtube.com/watch..." must not count as a YouTube link.
    const before = text[m.index - 1];
    if (before && /[\w/.=?&%-]/.test(before)) continue;
    const url = trimTrailing(m[0]);
    const parsed = parseYouTubeUrl(url);
    if (!parsed.ok || seen.has(parsed.videoId)) continue;
    seen.add(parsed.videoId);
    out.push({ videoId: parsed.videoId, url, isShort: parsed.isShort, startSeconds: parsed.startSeconds });
  }
  return out;
}

/** Collapses whitespace so an excerpt can be compared with the text it came from. */
export function normalizeSpace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** True when excerpt appears word for word in text (ignoring whitespace and curly quotes). */
export function isVerbatimExcerpt(excerpt: string, text: string): boolean {
  const norm = (s: string) => normalizeSpace(s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"'));
  const e = norm(excerpt);
  return e.length > 0 && norm(text).includes(e);
}
