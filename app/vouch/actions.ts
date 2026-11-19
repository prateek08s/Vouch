"use server";
import { refresh } from "next/cache";
import { getDb } from "@/lib/server/db";
import { allow, LIMIT_MESSAGE } from "@/lib/limits";
import { getCurrentUser } from "@/lib/server/session";
import { ingestYouTubeUrl, INGEST_ERROR_MESSAGES } from "@/lib/resources/ingest";
import { createVouch, MAX_TOPICS, NOTE_MAX, remainingVouchesToday, VOUCH_ERROR_MESSAGES } from "@/lib/vouches";
import { defaultMetadataProvider } from "@/lib/youtube/metadata";
import { str } from "@/lib/server/form";
import { socialEnabled } from "@/lib/flags";

export type VouchState =
  | { status: "idle" }
  | { status: "error"; message: string; field?: "url" | "note" | "topics" }
  | { status: "ok"; title: string; resourceId: string };

export async function vouchAction(_prev: VouchState, formData: FormData): Promise<VouchState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: "Sign in to vouch." };
  if (!socialEnabled() && !user.is_admin) return { status: "error", message: "Vouching is invite-only for now." };
  const db = await getDb();
  const topics = formData.getAll("topics").filter((t): t is string => typeof t === "string");
  // Validate and check the daily limit before any YouTube request: a refused vouch costs nothing.
  if (!topics.length) return { status: "error", field: "topics", message: VOUCH_ERROR_MESSAGES.topics_required };
  if (topics.length > MAX_TOPICS) return { status: "error", field: "topics", message: VOUCH_ERROR_MESSAGES.too_many_topics };
  if (str(formData, "note").trim().length > NOTE_MAX) return { status: "error", field: "note", message: VOUCH_ERROR_MESSAGES.note_too_long };
  if ((await remainingVouchesToday(db, user.id)) <= 0) return { status: "error", message: VOUCH_ERROR_MESSAGES.daily_limit_reached };
  if (!(await allow(db, "ingest", user.id))) return { status: "error", message: LIMIT_MESSAGE };

  const ingested = await ingestYouTubeUrl(str(formData, "url"), { db, metadata: defaultMetadataProvider() });
  if (!ingested.ok) return { status: "error", field: "url", message: INGEST_ERROR_MESSAGES[ingested.error] };

  const res = await createVouch(
    {
      userId: user.id,
      resourceId: ingested.resource.id,
      note: str(formData, "note"),
      topicSlugs: topics,
      isOwnContent: formData.get("own") === "on",
    },
    { db },
  );
  if (!res.ok) {
    const field = res.error === "note_too_long" ? "note" : res.error.includes("topic") ? "topics" : undefined;
    return { status: "error", field, message: VOUCH_ERROR_MESSAGES[res.error] };
  }
  refresh();
  return { status: "ok", title: ingested.resource.title, resourceId: ingested.resource.id };
}
