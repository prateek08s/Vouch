import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { browserEntries, browserState, nextLearningState, writeBrowserState } from "./browser";
import { EMPTY_LEARNING } from "./model";

let memory: Map<string, string>;
beforeEach(() => {
  memory = new Map();
  vi.stubGlobal("localStorage", { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value) });
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => vi.unstubAllGlobals());

const video = { id: "11111111-1111-4111-8111-111111111111", videoId: "dQw4w9WgXcQ", title: "A lesson", creatorName: "Teacher", thumbnailUrl: null, durationS: 100 };

it("preserves old saved and rated data while sharing state with Hide watched", () => {
  memory.set("vouch.v1", JSON.stringify({ saved: { [video.id]: { title: "Old save", thumb: null, at: 1 } }, watched: {}, ratings: { [video.id]: true }, hideWatched: true }));
  expect(browserEntries()[0]).toMatchObject({ title: "Old save", saved: true, status: null });
  writeBrowserState(video, { saved: true, status: "watched", positionS: 90 });
  const local = JSON.parse(memory.get("vouch.v1")!);
  expect(local.hideWatched).toBe(true);
  expect(local.ratings[video.id]).toBe(true);
  expect(local.watched[video.id]).toBeGreaterThan(0);
  expect(browserState(video.id).status).toBe("watched");
  writeBrowserState(video, { saved: false, status: "in_progress", positionS: 0 });
  expect(JSON.parse(memory.get("vouch.v1")!).saved[video.id]).toBeUndefined();
  expect(JSON.parse(memory.get("vouch.v1")!).watched[video.id]).toBeUndefined();
});

it("keeps watched or skipped choices when delayed playback samples arrive", () => {
  expect(nextLearningState({ ...EMPTY_LEARNING, status: "skipped" }, { action: "playback", positionS: 95, observedAt: 1 }, 100).status).toBe("skipped");
  expect(nextLearningState(EMPTY_LEARNING, { action: "save", saved: true }, 100).status).toBeNull();
});

it("recovers from corrupt storage and rejects an arbitrary image URL", () => {
  memory.set("vouch.v1", "broken");
  expect(browserEntries()).toEqual([]);
  memory.set("vouch.v1", JSON.stringify({ progress: { [video.id]: { ...video, thumbnailUrl: "https://attacker.example/a", saved: true, status: null, positionS: 0, updatedAt: new Date().toISOString() } } }));
  expect(browserEntries()).toEqual([]);
});

it("ignores invalid saved timestamps and tolerates null progress entries", () => {
  memory.set("vouch.v1", JSON.stringify({ saved: { [video.id]: { title: "Old save", thumb: null, at: 1e100 } }, progress: { "broken": null } }));
  expect(() => browserEntries()).not.toThrow();
  expect(() => writeBrowserState(video, { saved: true, status: null, positionS: 0 })).not.toThrow();
});