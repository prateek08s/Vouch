"use server";
import { refresh } from "next/cache";
import { getCurrentUser } from "@/lib/server/session";
import { getDb } from "@/lib/server/db";
import { UUID, str } from "@/lib/server/form";
import { allow, LIMIT_MESSAGE } from "@/lib/limits";
import { savePath } from "@/lib/paths";

export type PathFormState = { status: "idle" | "ok" | "error"; message?: string };
export async function savePathAction(_previous: PathFormState, form: FormData): Promise<PathFormState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: "Sign in to edit a learning path." };
  const id = str(form, "listId");
  if (!UUID.test(id)) return { status: "error", message: "Choose a collection." };
  const db = await getDb();
  if (!(await allow(db, "write", user.id))) return { status: "error", message: LIMIT_MESSAGE };
  const result = await savePath(db, user.id, id, {
    enabled: form.get("enabled") === "on", level: str(form, "level"),
    prerequisites: str(form, "prerequisites"), outcomes: str(form, "outcomes"),
  });
  if (!result.ok) return { status: "error", message: result.error };
  refresh();
  return { status: "ok", message: "Learning path settings saved." };
}
