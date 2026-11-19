"use server";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/server/db";
import { allow } from "@/lib/limits";
import { getCurrentUser } from "@/lib/server/session";
import { rate, recordOpen } from "@/lib/ratings";
import { createRule } from "@/lib/rules";
import { UUID, str } from "@/lib/server/form";
import { isReason, reportVouch } from "@/lib/moderation";

export async function rateAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const resourceId = str(formData, "resourceId");
  const via = str(formData, "via");
  const verdict = str(formData, "verdict");
  if (!UUID.test(resourceId) || (verdict !== "worth" && verdict !== "not")) return;

  const db = await getDb();
  if (!(await allow(db, "write", user.id))) return;
  // Attribution is normally recorded when the video is opened; this covers a rating posted
  // before that (an older page). The first attribution always wins.
  if (UUID.test(via)) await recordOpen(db, { userId: user.id, resourceId, vouchId: via });
  await rate({ userId: user.id, resourceId, worthIt: verdict === "worth" }, { db });
  refresh();
}

/** Plan flow C: "Never show this channel" from a video, then confirm with an undo on the Circle. */
export async function blockChannelAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const resourceId = str(formData, "resourceId");
  if (!UUID.test(resourceId)) return;
  const db = await getDb();
  const [res] = await db.query<{ creator_external_id: string | null }>(
    "select creator_external_id from resources where id = $1",
    [resourceId],
  );
  if (!res?.creator_external_id) return;
  const r = await createRule(db, user.id, "channel", res.creator_external_id);
  if (r.ok) redirect(`/?blocked=${r.rule.id}`);
}

/** Report a vouch's note to the admins. Quietly ignores repeats and bad input. */
export async function reportAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const vouchId = str(formData, "vouchId");
  const reason = str(formData, "reason");
  if (!UUID.test(vouchId) || !isReason(reason)) return;
  const db = await getDb();
  if (!(await allow(db, "write", user.id))) return;
  await reportVouch(db, user.id, vouchId, reason, str(formData, "details"));
  refresh();
}
