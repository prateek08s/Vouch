"use server";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/server/db";
import { allow, LIMIT_MESSAGE } from "@/lib/limits";
import { getCurrentUser } from "@/lib/server/session";
import { LIST_ERROR_MESSAGES, addToList, createList, deleteList, followList, moveItem, removeFromList, unfollowList } from "@/lib/lists";
import { UUID, str } from "@/lib/server/form";

export type ListFormState = { status: "idle" } | { status: "error"; message: string };

export async function createListAction(_prev: ListFormState, formData: FormData): Promise<ListFormState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: "Sign in to make a list." };
  const r = await createList(await getDb(), user.id, {
    title: str(formData, "title"),
    description: str(formData, "description"),
    isPublic: formData.get("private") !== "on",
  });
  if (!r.ok) return { status: "error", message: LIST_ERROR_MESSAGES[r.error] };
  redirect(`/lists/${r.list.id}`);
}

export type AddToListState = { status: "idle" } | { status: "error"; message: string } | { status: "ok"; listTitle: string; listId: string };

export async function addToListAction(_prev: AddToListState, formData: FormData): Promise<AddToListState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: "Sign in first." };
  const listId = str(formData, "listId");
  const resourceId = str(formData, "resourceId");
  if (!UUID.test(listId) || !UUID.test(resourceId)) return { status: "error", message: "Choose a list." };
  const db = await getDb();
  if (!(await allow(db, "write", user.id))) return { status: "error", message: LIMIT_MESSAGE };
  const r = await addToList(db, user.id, listId, resourceId, str(formData, "note"));
  if (!r.ok) return { status: "error", message: LIST_ERROR_MESSAGES[r.error] };
  const [l] = await db.query<{ title: string }>("select title from lists where id = $1", [listId]);
  return { status: "ok", listTitle: l?.title ?? "your list", listId };
}

export async function listItemAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const listId = str(formData, "listId");
  const resourceId = str(formData, "resourceId");
  if (!UUID.test(listId) || !UUID.test(resourceId)) return;
  const db = await getDb();
  if (!(await allow(db, "write", user.id))) return;
  const op = str(formData, "op");
  if (op === "remove") await removeFromList(db, user.id, listId, resourceId);
  else if (op === "move") await moveItem(db, user.id, listId, resourceId, Number(str(formData, "to")));
  refresh();
}

export async function followListAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const listId = str(formData, "listId");
  if (!UUID.test(listId)) return;
  const db = await getDb();
  if (!(await allow(db, "write", user.id))) return;
  if (str(formData, "op") === "unfollow") await unfollowList(db, user.id, listId);
  else await followList(db, user.id, listId);
  refresh();
}

export async function deleteListAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const listId = str(formData, "listId");
  if (UUID.test(listId)) await deleteList(await getDb(), user.id, listId);
  redirect("/lists");
}
