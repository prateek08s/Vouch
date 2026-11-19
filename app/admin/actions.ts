"use server";
import { notFound, redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getDb } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/session";
import { dismissReports, hideVouch, suspendUser } from "@/lib/moderation";
import { UUID, str } from "@/lib/server/form";

async function admin() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  if (!user.is_admin) notFound();
  return user;
}

export async function hideVouchAction(formData: FormData) {
  const me = await admin();
  const vouchId = str(formData, "vouchId");
  if (!UUID.test(vouchId)) return;
  await hideVouch(await getDb(), me.id, vouchId);
  refresh();
}

export async function dismissReportsAction(formData: FormData) {
  const me = await admin();
  const vouchId = str(formData, "vouchId");
  if (!UUID.test(vouchId)) return;
  await dismissReports(await getDb(), me.id, vouchId);
  refresh();
}

export async function suspendUserAction(formData: FormData) {
  const me = await admin();
  const userId = str(formData, "userId");
  if (!UUID.test(userId) || userId === me.id) return;
  await suspendUser(await getDb(), me.id, userId);
  refresh();
}
