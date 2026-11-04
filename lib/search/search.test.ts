import { beforeAll, describe, expect, it } from "vitest";
import { openPglite, type Db } from "@/lib/db";
import * as fx from "@/lib/test/fixtures";
import { follow } from "@/lib/graph/follows";
import { createVouch } from "@/lib/vouches";
import { createRule } from "@/lib/rules";
import { addToList, createList } from "@/lib/lists";
import { parseQuery, search, toPrefixQuery } from "./index";

describe("toPrefixQuery", () => {
  it.each([
    ["GPU sched", "gpu:* & sched:*"],
    ["  transformers  ", "transformers:*"],
    ["C++ & rust | !drop", "c:* & rust:* & drop:*"],
    ["café", "cafe:*"],
    ["it's", "it:* & s:*"],
    ["", null],
    ["!!! ::: '' ", null],
    ["a b c d e f g h i j", "a:* & b:* & c:* & d:* & e:* & f:* & g:* & h:*"],
  ])("%j -> %s", (input, out) => expect(toPrefixQuery(input)).toBe(out));
});

describe("parseQuery", () => {
  it("extracts one @curator and leaves the rest", () => {
    expect(parseQuery("gpu @Priya talks")).toEqual({ text: "gpu  talks", curator: "priya", circleOnly: false });
    expect(parseQuery("@priya")).toMatchObject({ text: "", curator: "priya" });
    expect(parseQuery("email@priya.com")).toMatchObject({ curator: null });
  });
});

describe("search", () => {
  let db: Db;
  let viewer: string, priya: string, stranger: string;
  let gpuTalk: string, rustIntro: string, cryptoHype: string, notes: string;

  beforeAll(async () => {
    db = await openPglite();
    viewer = await fx.user(db, "viewer_s");
    priya = await fx.user(db, "priya_s", "founding");
    stranger = await fx.user(db, "stranger_s", "founding");
    await follow(db, viewer, priya);
    await db.query("update users set display_name = 'Priya Nair' where id = $1", [priya]);

    gpuTalk = await fx.resource(db, { title: "How GPUs Actually Schedule Work", channelName: "Chips Explained", durationS: 38 * 60 });
    rustIntro = await fx.resource(db, { title: "Rust for Beginners", channelName: "Ferris Talks" });
    cryptoHype = await fx.resource(db, { title: "GPU Mining Crypto Riches", channelId: "UC_hype", channelName: "Hype" });
    notes = await fx.resource(db, { title: "An Untitled Talk", channelName: "Conf" });
    const unvouched = await fx.resource(db, { title: "GPU video nobody vouched" });
    void unvouched;

    await createVouch({ userId: priya, resourceId: gpuTalk, topicSlugs: ["gpu"], note: "Best scheduling explainer." }, { db });
    await createVouch({ userId: stranger, resourceId: gpuTalk, topicSlugs: ["gpu"] }, { db });
    await createVouch({ userId: stranger, resourceId: rustIntro, topicSlugs: ["rust"] }, { db });
    await createVouch({ userId: stranger, resourceId: cryptoHype, topicSlugs: ["gpu"] }, { db });
    await createVouch({ userId: priya, resourceId: notes, topicSlugs: ["distributed-systems"], note: "The clearest take on consensus protocols." }, { db });
  });

  const ids = (r: Awaited<ReturnType<typeof search>>) => r.results.map((x) => x.resourceId);

  it("returns nothing for an empty query", async () => {
    expect((await search(db, viewer, "   ")).results).toEqual([]);
  });

  it("matches titles by prefix and only returns vouched resources", async () => {
    const r = await search(db, viewer, "gpu sched");
    expect(ids(r)).toEqual([gpuTalk]);
    const all = await search(db, viewer, "gpu");
    expect(all.results.map((x) => x.title)).not.toContain("GPU video nobody vouched");
  });

  it("ranks the circle's pick above an equally relevant stranger pick", async () => {
    const r = await search(db, viewer, "gpu");
    expect(ids(r).slice(0, 2)).toEqual([gpuTalk, cryptoHype]);
    expect(r.results[0]).toMatchObject({ circleVouchers: ["Priya Nair"], vouchCount: 2, topics: ["GPU"] });
    expect(r.results[0].topNote).toEqual({ text: "Best scheduling explainer.", by: "Priya Nair" });
  });

  it("finds resources by vouch note text and by topic name", async () => {
    expect(ids(await search(db, viewer, "consensus"))).toEqual([notes]);
    expect(ids(await search(db, viewer, "distributed"))).toEqual([notes]);
  });

  it("filters by curator with @username and by Circle only", async () => {
    expect(ids(await search(db, viewer, "@priya_s")).sort()).toEqual([gpuTalk, notes].sort());
    expect(ids(await search(db, viewer, "rust", { circleOnly: true }))).toEqual([]);
    expect(ids(await search(db, viewer, "rust"))).toEqual([rustIntro]);
  });

  it("filters by topic including subtopics", async () => {
    const r = await search(db, viewer, "", { topic: "hardware" });
    expect(ids(r).sort()).toEqual([gpuTalk, cryptoHype].sort());
    expect((await search(db, viewer, "", { topic: "no-such-topic" })).results).toEqual([]);
  });

  it("applies hard rules to search results too", async () => {
    const v2 = await fx.user(db);
    await createRule(db, v2, "keyword", "crypto");
    const r = await search(db, v2, "gpu");
    expect(ids(r)).toEqual([gpuTalk]);
    expect(r.hiddenByRules).toBe(1);
  });

  it("treats hostile input as plain words", async () => {
    for (const q of ["'); drop table users; --", "gpu & | ! ( ) :*", "\\x00", "%_%"]) {
      await expect(search(db, viewer, q)).resolves.toBeDefined();
    }
    const [{ n }] = await db.query<{ n: number }>("select count(*)::int n from users");
    expect(n).toBeGreaterThan(0);
  });

  it("finds public lists by title, and private lists only for their owner", async () => {
    const pub = await createList(db, priya, { title: "Scheduling deep dives" });
    const priv = await createList(db, priya, { title: "Scheduling secrets", isPublic: false });
    if (pub.ok) await addToList(db, priya, pub.list.id, gpuTalk);
    const forViewer = await search(db, viewer, "scheduling");
    expect(forViewer.lists.map((l) => l.title)).toEqual(["Scheduling deep dives"]);
    expect(forViewer.lists[0]).toMatchObject({ ownerName: "Priya Nair", itemCount: 1 });
    const forOwner = await search(db, priya, "scheduling");
    expect(forOwner.lists.map((l) => l.title).sort()).toEqual(["Scheduling deep dives", "Scheduling secrets"]);
    void priv;
  });

  it("survives stop-word-only queries without errors", async () => {
    for (const q of ["the", "a an the", "of"]) {
      const r = await search(db, viewer, q);
      expect(Array.isArray(r.results)).toBe(true);
    }
  });

  it("hides removed videos", async () => {
    const gone = await fx.resource(db, { title: "Quantum Widgets" });
    await createVouch({ userId: priya, resourceId: gone, topicSlugs: ["physics"] }, { db });
    expect(ids(await search(db, viewer, "quantum"))).toEqual([gone]);
    await db.query("update resources set metadata_status = 'unavailable' where id = $1", [gone]);
    expect(ids(await search(db, viewer, "quantum"))).toEqual([]);
  });
});
