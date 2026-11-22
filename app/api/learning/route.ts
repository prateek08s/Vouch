import { sameOrigin } from "@/lib/learning/origin";
import { z } from "zod";
import { getCurrentUser } from "@/lib/server/session";
import { getDb } from "@/lib/server/db";
import { allow } from "@/lib/limits";
import { MAX_POSITION_S, savePlayback, setLearningStatus, setSaved } from "@/lib/learning";

const id = z.string().uuid();
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), resourceId: id, saved: z.boolean() }),
  z.object({ action: z.literal("status"), resourceId: id, status: z.enum(["in_progress", "watched", "skipped"]) }),
  z.object({ action: z.literal("playback"), resourceId: id, positionS: z.number().min(0).max(MAX_POSITION_S), observedAt: z.number().int(), ended: z.boolean().optional() }),
]);

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return Response.json({ error: "Open Vouch to update your learning history." }, { status: 403 });
  }
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in again to save your progress." }, { status: 401 });
  const text = await request.text();
  if (text.length > 4096) return Response.json({ error: "The update is too large." }, { status: 413 });
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return Response.json({ error: "Invalid update." }, { status: 400 }); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "Invalid update." }, { status: 400 });
  const input = parsed.data;
  const db = await getDb();
  if (!(await allow(db, "learning", user.id))) return Response.json({ error: "Too many updates. Try again shortly." }, { status: 429 });
  let ok: boolean;
  if (input.action === "save") ok = await setSaved(db, user.id, input.resourceId, input.saved);
  else if (input.action === "status") ok = await setLearningStatus(db, user.id, input.resourceId, input.status);
  else ok = await savePlayback(db, user.id, input.resourceId, input);
  return Response.json({ ok }, { status: ok ? 200 : 409, headers: { "Cache-Control": "private, no-store" } });
}
