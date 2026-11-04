import { describe, expect, it } from "vitest";
import { decodeEntities, extractYouTubeLinks, hnHtmlToText, isVerbatimExcerpt } from "./text";

// Real comment shapes from the HN dataset (January 2025).
const REAL_1 =
  'here&#x27;s a video of a Chinese family living on the 16th floor of a rotten tail building (unfinished building) with no running water or electricity.<p><a href="https:&#x2F;&#x2F;www.youtube.com&#x2F;watch?v=ZjaE8mDbq68" rel="nofollow">https:&#x2F;&#x2F;www.youtube.com&#x2F;watch?v=ZjaE8mDbq68</a>';
const REAL_2 =
  'I actually watched it as a stage production. I have never seen the film beyond this clip.<p><a href="https:&#x2F;&#x2F;m.youtube.com&#x2F;watch?v=Ahqu1nd3Zu8" rel="nofollow">https:&#x2F;&#x2F;m.youtube.com&#x2F;watch?v=Ahqu1nd3Zu8</a><p>Hard to believe that <i>Sweeney Todd</i> was from the same man.';
const MENTION_ONLY =
  "Contacted his internal youtube contacts and all. There should be videos about him talking of it.";

describe("decodeEntities", () => {
  it("decodes the entities HN emits", () => {
    expect(decodeEntities("it&#x27;s &quot;a&quot; &amp; b &lt;c&gt; &#x2F; &#39;")).toBe(`it's "a" & b <c> / '`);
  });
  it("leaves unknown or invalid entities alone", () => {
    expect(decodeEntities("&bogus; &#xFFFFFFF; &#0;")).toBe("&bogus; &#xFFFFFFF; &#0;");
  });
  it("decodes only once (&amp;amp; stays &amp;)", () => {
    expect(decodeEntities("&amp;amp;")).toBe("&amp;");
  });
});

describe("hnHtmlToText", () => {
  it("turns paragraphs into blank lines and links into their full href", () => {
    expect(hnHtmlToText(REAL_1)).toBe(
      "here's a video of a Chinese family living on the 16th floor of a rotten tail building (unfinished building) with no running water or electricity.\n\nhttps://www.youtube.com/watch?v=ZjaE8mDbq68",
    );
  });
  it("uses the href, not the truncated display text", () => {
    const html = '<a href="https:&#x2F;&#x2F;www.youtube.com&#x2F;watch?v=aircAruvnKk&amp;t=30">https:&#x2F;&#x2F;www.youtube.com&#x2F;watch?v=airc...</a>';
    expect(hnHtmlToText(html)).toBe("https://www.youtube.com/watch?v=aircAruvnKk&t=30");
  });
  it("strips formatting tags and keeps their text", () => {
    expect(hnHtmlToText("<i>Sweeney Todd</i> and <pre><code>  x = 1</code></pre>")).toBe("Sweeney Todd and   x = 1");
  });
});

describe("extractYouTubeLinks", () => {
  it("finds the video in real comments", () => {
    expect(extractYouTubeLinks(REAL_1)).toEqual([
      { videoId: "ZjaE8mDbq68", url: "https://www.youtube.com/watch?v=ZjaE8mDbq68", isShort: false, startSeconds: null },
    ]);
    expect(extractYouTubeLinks(REAL_2).map((l) => l.videoId)).toEqual(["Ahqu1nd3Zu8"]);
  });

  it("ignores comments that only mention YouTube", () => {
    expect(extractYouTubeLinks(MENTION_ONLY)).toEqual([]);
  });

  it("ignores YouTube links that are not single videos", () => {
    const html = [
      "https://www.youtube.com/@3blue1brown",
      "https://www.youtube.com/channel/UCYO_jab_esuFRV4b17AJtAw",
      "https://www.youtube.com/playlist?list=PLZHQObOWTQDPD3MizzM2xVFitgF8hE_ab",
      "https://www.youtube.com/results?search_query=fourier",
    ].join(" ");
    expect(extractYouTubeLinks(html, { isHtml: false })).toEqual([]);
  });

  it("keeps the start time and Shorts flag", () => {
    const links = extractYouTubeLinks("at https://youtu.be/aircAruvnKk?t=95 and https://youtube.com/shorts/VMj-3S1tku0", { isHtml: false });
    expect(links).toEqual([
      { videoId: "aircAruvnKk", url: "https://youtu.be/aircAruvnKk?t=95", isShort: false, startSeconds: 95 },
      { videoId: "VMj-3S1tku0", url: "https://youtube.com/shorts/VMj-3S1tku0", isShort: true, startSeconds: null },
    ]);
  });

  it("lists each video once, in order of first appearance", () => {
    const text = "https://youtu.be/bBC-nXj3Ng4 then https://www.youtube.com/watch?v=aircAruvnKk then https://youtu.be/bBC-nXj3Ng4?t=10";
    expect(extractYouTubeLinks(text, { isHtml: false }).map((l) => l.videoId)).toEqual(["bBC-nXj3Ng4", "aircAruvnKk"]);
  });

  it("trims punctuation and unopened brackets after a link", () => {
    const text = "(see https://youtu.be/aircAruvnKk). Also [https://www.youtube.com/watch?v=VMj-3S1tku0], fine!";
    expect(extractYouTubeLinks(text, { isHtml: false }).map((l) => l.url)).toEqual([
      "https://youtu.be/aircAruvnKk",
      "https://www.youtube.com/watch?v=VMj-3S1tku0",
    ]);
  });

  it("accepts links without a scheme", () => {
    expect(extractYouTubeLinks("try youtube.com/watch?v=aircAruvnKk", { isHtml: false })[0]?.videoId).toBe("aircAruvnKk");
  });

  it("rejects lookalike hosts and YouTube URLs embedded in other URLs", () => {
    const text = [
      "https://youtube.com.evil.example/watch?v=aircAruvnKk",
      "https://notyoutube.com/watch?v=aircAruvnKk",
      "https://evil.example/?u=youtube.com/watch?v=aircAruvnKk",
      "https://web.archive.org/web/2020/https://www.youtube.com/watch?v=aircAruvnKk",
    ].join(" ");
    expect(extractYouTubeLinks(text, { isHtml: false })).toEqual([]);
  });

  it("rejects malformed video IDs", () => {
    expect(extractYouTubeLinks("https://youtu.be/short https://youtu.be/waytoolongid123", { isHtml: false })).toEqual([]);
  });
});

describe("isVerbatimExcerpt", () => {
  const text = hnHtmlToText(REAL_2);
  it("accepts an exact quote, ignoring whitespace differences", () => {
    expect(isVerbatimExcerpt("I actually watched it as a stage   production.", text)).toBe(true);
    expect(isVerbatimExcerpt("Hard to believe that Sweeney Todd was from the same man.", text)).toBe(true);
  });
  it("accepts curly quotes standing in for straight ones", () => {
    expect(isVerbatimExcerpt("here’s a video", hnHtmlToText(REAL_1))).toBe(true);
  });
  it("rejects paraphrases and empty strings", () => {
    expect(isVerbatimExcerpt("A great stage production of Sweeney Todd.", text)).toBe(false);
    expect(isVerbatimExcerpt("   ", text)).toBe(false);
  });
});
