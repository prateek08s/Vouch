import type { Db } from "@/lib/db";
import { follow } from "@/lib/graph/follows";
import { rate } from "@/lib/ratings";
import { ingestYouTubeUrl } from "@/lib/resources/ingest";
import { createUser } from "@/lib/users";
import { createVouch } from "@/lib/vouches";
import { defaultMetadataProvider, type MetadataProvider } from "@/lib/youtube/metadata";

/**
 * Local demo data so the Circle is never empty in development.
 * Videos are real; metadata is fetched live. If YouTube is unreachable a known title is used,
 * but an ID YouTube reports as missing is skipped rather than shown with invented data.
 */

const CURATORS = [
  { username: "priya", displayName: "Priya Nair", bio: "ML engineer. I vouch for explanations that made something click." },
  { username: "arjun", displayName: "Arjun Mehta", bio: "Systems and hardware. Talks over tutorials." },
  { username: "maya", displayName: "Maya Chen", bio: "Designer who reads papers. Visual explanations first." },
  { username: "james", displayName: "James Rao", bio: "Science teacher. If it uses an animation well, I'll find it." },
];
const VIEWER = { username: "alex", displayName: "Alex Rivera", bio: "Here to spend 40 minutes well." };

type SeedVideo = { id: string; title: string; channel: string };
const V = {
  nn: { id: "aircAruvnKk", title: "But what is a neural network?", channel: "3Blue1Brown" },
  micrograd: { id: "VMj-3S1tku0", title: "The spelled-out intro to neural networks and backpropagation: building micrograd", channel: "Andrej Karpathy" },
  llmIntro: { id: "zjkBMFhNj_g", title: "[1hr Talk] Intro to Large Language Models", channel: "Andrej Karpathy" },
  bitcoin: { id: "bBC-nXj3Ng4", title: "But how does bitcoin actually work?", channel: "3Blue1Brown" },
  gpt: { id: "kCc8FmEb1nY", title: "Let's build GPT: from scratch, in code, spelled out.", channel: "Andrej Karpathy" },
  transformers: { id: "wjZofJX0v4M", title: "Transformers, the tech behind LLMs", channel: "3Blue1Brown" },
  fourier: { id: "spUNpyF58BY", title: "But what is the Fourier Transform? A visual introduction.", channel: "3Blue1Brown" },
  eventLoop: { id: "8aGhZQkoFbQ", title: "What the heck is the event loop anyway?", channel: "JSConf" },
  fourierSeries: { id: "r6sGWTCMz2k", title: "But what is a Fourier series? From heat flow to drawing with circles", channel: "3Blue1Brown" },
} satisfies Record<string, SeedVideo>;

type Plan = { video: SeedVideo; by: string; topics: string[]; hoursAgo: number; note?: string; own?: boolean };

/** Older picks the viewer already rated. These give "Why this?" real evidence to cite. */
const HISTORY: (Plan & { worthIt: boolean })[] = [
  { video: V.nn, by: "priya", topics: ["ai"], hoursAgo: 24 * 20, worthIt: true },
  { video: V.micrograd, by: "priya", topics: ["ai"], hoursAgo: 24 * 14, worthIt: true },
  { video: V.llmIntro, by: "priya", topics: ["ai", "llms"], hoursAgo: 24 * 9, worthIt: true },
  { video: V.bitcoin, by: "arjun", topics: ["security"], hoursAgo: 24 * 12, worthIt: false },
];

/** Fresh vouches that make up today's Circle. */
const FRESH: Plan[] = [
  { video: V.gpt, by: "priya", topics: ["ai", "programming"], hoursAgo: 5, note: "The best two hours you can spend on how LLMs work. Code along, don't just watch." },
  { video: V.gpt, by: "arjun", topics: ["programming"], hoursAgo: 30 },
  { video: V.transformers, by: "maya", topics: ["llms"], hoursAgo: 8, note: "The attention visualisations alone are worth it." },
  { video: V.transformers, by: "james", topics: ["llms"], hoursAgo: 20 },
  { video: V.fourier, by: "james", topics: ["pure-math"], hoursAgo: 12, note: "I show this to every class. The winding machine makes it obvious." },
  { video: V.eventLoop, by: "arjun", topics: ["web"], hoursAgo: 26, note: "Still the clearest talk on how JavaScript actually runs." },
  { video: V.fourierSeries, by: "maya", topics: ["pure-math"], hoursAgo: 50 },
];

/** Offline fallback: answers with the known title only when YouTube is unreachable. */
function withFallback(live: MetadataProvider, known: Map<string, SeedVideo>): MetadataProvider {
  return {
    async fetch(id) {
      const r = await live.fetch(id);
      const k = known.get(id);
      if (r.ok || r.error !== "metadata_unavailable" || !k) return r;
      return {
        ok: true,
        metadata: {
          videoId: id, title: k.title, channelId: null, channelName: k.channel, durationSeconds: null,
          thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, publishedAt: null, completeness: "partial",
        },
      };
    },
  };
}

export async function seedDemo(db: Db, opts: { metadata?: MetadataProvider; now?: Date } = {}) {
  const [{ n }] = await db.query<{ n: number }>("select count(*)::int n from users where username = $1", [VIEWER.username]);
  if (n > 0) return { seeded: false as const };

  const now = opts.now ?? new Date();
  const at = (hoursAgo: number) => () => new Date(now.getTime() - hoursAgo * 3_600_000);
  const known = new Map(Object.values(V).map((v) => [v.id, v]));
  const metadata = withFallback(opts.metadata ?? defaultMetadataProvider(), known);

  const ids = new Map<string, string>();
  for (const c of [...CURATORS, VIEWER]) {
    const r = await createUser(db, { ...c, trustTier: c === VIEWER ? "new" : "founding" });
    if (!r.ok) throw new Error(`seed user ${c.username}: ${r.error}`);
    ids.set(c.username, r.user.id);
  }
  const viewer = ids.get(VIEWER.username)!;
  // Demo accounts arrive with their circle already set up, so they skip onboarding.
  await db.query("update users set onboarded_at = created_at where id = any($1::uuid[])", [[...ids.values()]]);
  for (const c of CURATORS) await follow(db, viewer, ids.get(c.username)!);

  const resources = new Map<string, string>();
  const skipped: string[] = [];
  for (const v of known.values()) {
    const r = await ingestYouTubeUrl(`https://www.youtube.com/watch?v=${v.id}`, { db, metadata });
    if (r.ok) resources.set(v.id, r.resource.id);
    else skipped.push(`${v.id}:${r.error}`);
  }

  const plans = [...HISTORY, ...FRESH].sort((a, b) => b.hoursAgo - a.hoursAgo);
  for (const p of plans) {
    const resourceId = resources.get(p.video.id);
    if (!resourceId) continue;
    const r = await createVouch(
      { userId: ids.get(p.by)!, resourceId, topicSlugs: p.topics, note: p.note, isOwnContent: p.own },
      { db, now: at(p.hoursAgo) },
    );
    if (!r.ok) throw new Error(`seed vouch ${p.video.id} by ${p.by}: ${r.error}`);
  }
  for (const h of HISTORY) {
    const resourceId = resources.get(h.video.id);
    if (resourceId) await rate({ userId: viewer, resourceId, worthIt: h.worthIt }, { db, now: at(h.hoursAgo - 24) });
  }
  if (skipped.length) console.warn(`[vouch seed] skipped videos: ${skipped.join(", ")}`);
  return { seeded: true as const, viewerId: viewer, skipped };
}
