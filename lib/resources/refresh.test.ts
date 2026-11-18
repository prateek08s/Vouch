import { beforeAll, expect, it } from "vitest";
import { openPglite, type Db } from "@/lib/db";
import * as fx from "@/lib/test/fixtures";
import type { MetadataProvider } from "@/lib/youtube/metadata";
import { refreshStaleMetadata } from "./refresh";

let db: Db;
beforeAll(async () => { db = await openPglite(); });

const NOW = new Date("2026-11-19T00:00:00Z");
const old = new Date("2026-10-01T00:00:00Z");

it("refreshes old records, marks removed videos unavailable, and keeps transient failures for later", async () => {
  const fine = await fx.resource(db, { externalId: "aaaaaaaaaaa", title: "Old title" });
  const gone = await fx.resource(db, { externalId: "bbbbbbbbbbb" });
  const flaky = await fx.resource(db, { externalId: "ccccccccccc" });
  const fresh = await fx.resource(db, { externalId: "ddddddddddd", title: "Fresh" });
  await db.query("update resources set metadata_refreshed_at = $1 where id = any($2::uuid[])", [old, [fine, gone, flaky]]);
  await db.query("update resources set metadata_refreshed_at = $1 where id = $2", [NOW, fresh]);
  const calls: string[] = [];
  const provider: MetadataProvider = {
    async fetch(id) {
      calls.push(id);
      if (id === "bbbbbbbbbbb") return { ok: false, error: "video_not_found" };
      if (id === "ccccccccccc") return { ok: false, error: "metadata_unavailable" };
      return { ok: true, metadata: { videoId: id, title: "New title", channelId: "UC_default", channelName: "Default Channel", durationSeconds: 600, thumbnailUrl: null, publishedAt: null, completeness: "ok" } };
    },
  };
  const stats = await refreshStaleMetadata(db, provider, { now: NOW });
  expect(stats).toEqual({ checked: 3, refreshed: 1, unavailable: 1, failed: 1 });
  expect(calls.sort()).toEqual(["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"]);
  const rows = await db.query<{ id: string; title: string; metadata_status: string }>("select id, title, metadata_status from resources where id = any($1::uuid[])", [[fine, gone, flaky]]);
  const by = new Map(rows.map((r) => [r.id, r]));
  expect(by.get(fine)).toMatchObject({ title: "New title", metadata_status: "ok" });
  expect(by.get(gone)?.metadata_status).toBe("unavailable");
  expect(by.get(flaky)).toMatchObject({ metadata_status: "ok" });
});

it("moves channel rules when the channel key changes from a URL to an ID", async () => {
  const viewer = await fx.user(db);
  const r = await fx.resource(db, { externalId: "eeeeeeeeeee", channelId: "https://www.youtube.com/@chan" });
  await db.query("update resources set metadata_refreshed_at = $1 where id = $2", [old, r]);
  await db.query("insert into rules (user_id, kind, value) values ($1, 'channel', 'https://www.youtube.com/@chan')", [viewer]);
  const provider: MetadataProvider = {
    async fetch(id) {
      return { ok: true, metadata: { videoId: id, title: "T", channelId: "UCrealid", channelName: "Chan", durationSeconds: 300, thumbnailUrl: null, publishedAt: null, completeness: "ok" } };
    },
  };
  await refreshStaleMetadata(db, provider, { now: NOW });
  const rules = await db.query<{ value: string }>("select value from rules where user_id = $1", [viewer]);
  expect(rules.map((x) => x.value)).toEqual(["UCrealid"]);
});
