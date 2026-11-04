import { describe, expect, it } from "vitest";
import { parseYouTubeUrl, canonicalYouTubeUrl } from "./parse";

const ID = "dQw4w9WgXcQ";

describe("parseYouTubeUrl: accepted shapes", () => {
  const cases: [string, string][] = [
    ["standard watch", `https://www.youtube.com/watch?v=${ID}`],
    ["no www", `https://youtube.com/watch?v=${ID}`],
    ["no scheme", `youtube.com/watch?v=${ID}`],
    ["http", `http://www.youtube.com/watch?v=${ID}`],
    ["mobile", `https://m.youtube.com/watch?v=${ID}`],
    ["music", `https://music.youtube.com/watch?v=${ID}`],
    ["extra params before v", `https://www.youtube.com/watch?feature=share&v=${ID}`],
    ["with playlist", `https://www.youtube.com/watch?v=${ID}&list=PL123&index=4`],
    ["short link", `https://youtu.be/${ID}`],
    ["short link with si", `https://youtu.be/${ID}?si=abcDEF123`],
    ["embed", `https://www.youtube.com/embed/${ID}`],
    ["nocookie embed", `https://www.youtube-nocookie.com/embed/${ID}?rel=0`],
    ["legacy /v/", `https://www.youtube.com/v/${ID}`],
    ["live", `https://www.youtube.com/live/${ID}?feature=share`],
    ["uppercase host", `https://WWW.YOUTUBE.COM/watch?v=${ID}`],
    ["surrounding whitespace", `   https://youtu.be/${ID}  \n`],
    ["trailing slash", `https://youtu.be/${ID}/`],
    ["hash fragment", `https://www.youtube.com/watch?v=${ID}#comments`],
  ];

  it.each(cases)("%s", (_label, url) => {
    const r = parseYouTubeUrl(url);
    expect(r).toMatchObject({ ok: true, videoId: ID, isShort: false });
  });

  it("flags Shorts so 'no Shorts' rules can use it", () => {
    expect(parseYouTubeUrl(`https://www.youtube.com/shorts/${ID}`)).toMatchObject({
      ok: true,
      videoId: ID,
      isShort: true,
    });
  });

  it("keeps IDs containing - and _", () => {
    expect(parseYouTubeUrl("https://youtu.be/a-B_c1D2e3F")).toMatchObject({
      ok: true,
      videoId: "a-B_c1D2e3F",
    });
  });

  it.each([
    ["t=90", 90],
    ["t=90s", 90],
    ["t=1m30s", 90],
    ["t=1h2m3s", 3723],
    ["start=45", 45],
  ])("reads start time %s", (q, secs) => {
    expect(parseYouTubeUrl(`https://youtu.be/${ID}?${q}`)).toMatchObject({
      ok: true,
      startSeconds: secs,
    });
  });

  it("has no start time when absent", () => {
    const r = parseYouTubeUrl(`https://youtu.be/${ID}`);
    expect(r.ok && r.startSeconds).toBe(null);
  });
});

describe("parseYouTubeUrl: rejected input", () => {
  const cases: [string, string, string][] = [
    ["empty", "", "empty"],
    ["whitespace only", "   ", "empty"],
    ["not a url", "hello world", "not_youtube"],
    ["other site", `https://vimeo.com/${ID}`, "not_youtube"],
    ["lookalike suffix", `https://youtube.com.evil.example/watch?v=${ID}`, "not_youtube"],
    ["lookalike prefix", `https://notyoutube.com/watch?v=${ID}`, "not_youtube"],
    ["lookalike short", `https://youtu.be.evil.example/${ID}`, "not_youtube"],
    ["javascript scheme", `javascript:alert('youtube.com/watch?v=${ID}')`, "not_youtube"],
    ["ftp scheme", `ftp://youtube.com/watch?v=${ID}`, "not_youtube"],
    ["channel", "https://www.youtube.com/@veritasium", "no_video_id"],
    ["playlist only", "https://www.youtube.com/playlist?list=PL123", "no_video_id"],
    ["home", "https://www.youtube.com/", "no_video_id"],
    ["watch without v", "https://www.youtube.com/watch?x=1", "no_video_id"],
    ["id too short", "https://youtu.be/abc", "invalid_video_id"],
    ["id too long", `https://youtu.be/${ID}X`, "invalid_video_id"],
    ["id bad chars", "https://www.youtube.com/watch?v=dQw4w9WgX!Q", "invalid_video_id"],
  ];

  it.each(cases)("%s", (_label, url, error) => {
    expect(parseYouTubeUrl(url)).toEqual({ ok: false, error });
  });
});

describe("canonicalYouTubeUrl", () => {
  it("builds one stable URL per video, so duplicates collapse", () => {
    expect(canonicalYouTubeUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
  });
});
