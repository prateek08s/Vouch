"use server";
import { refresh } from "next/cache";
import { getCurrentUser } from "@/lib/server/session";
import { getDb } from "@/lib/server/db";
import { UUID, str } from "@/lib/server/form";
import { allow, LIMIT_MESSAGE } from "@/lib/limits";
import { addLessonResource, removeLessonResource } from "@/lib/lesson-resources";
export type ResourceFormState = { status: "idle" | "ok" | "error"; message?: string };
export async function lessonResourceAction(_previous: ResourceFormState, form: FormData): Promise<ResourceFormState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: "Sign in to manage lesson resources." };
  const listId = str(form, "listId"), resourceId = str(form, "resourceId"), attachmentId = str(form, "attachmentId");
  if (!UUID.test(listId) || !UUID.test(resourceId)) return { status: "error", message: "Choose a lesson." };
  const op = str(form, "op");
  if (op !== "add" && op !== "remove") return { status: "error", message: "Choose an action." };
  if (op === "remove" && !UUID.test(attachmentId)) return { status: "error", message: "Choose a resource." };
  const db = await getDb();
  if (!(await allow(db, "write", user.id))) return { status: "error", message: LIMIT_MESSAGE };
  const result = op === "remove" ? await removeLessonResource(db, user.id, listId, resourceId, attachmentId) :
    await addLessonResource(db, user.id, listId, resourceId, { kind: str(form, "kind"), title: str(form, "title"), url: str(form, "url") });
  if (!result.ok) return { status: "error", message: result.error };
  refresh();
  return { status: "ok", message: op === "remove" ? "Resource removed." : "Resource added." };
}
