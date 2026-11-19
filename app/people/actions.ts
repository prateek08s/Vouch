"use server";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/server/db";
import { allow } from "@/lib/limits";
import { getCurrentUser } from "@/lib/server/session";
import { follow, unfollow } from "@/lib/graph/follows";
import { UUID, str } from "@/lib/server/form";

export async function followAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const target = str(formData, "userId");
  if (!UUID.test(target)) return;
  const db = await getDb();
  if (!(await allow(db, "write", user.id))) return;
  if (str(formData, "op") === "unfollow") await unfollow(db, user.id, target);
  else await follow(db, user.id, target);
  refresh();
}
