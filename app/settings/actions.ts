"use server";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getDb } from "@/lib/server/db";
import { getCurrentUser, signOut } from "@/lib/server/session";
import { PROFILE_ERROR_MESSAGES, updateProfile } from "@/lib/users";
import { deleteAccount } from "@/lib/users/account";
import { deleteAuthUser } from "@/lib/auth/admin";

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v : "";
};

export type ProfileState = { status: "idle" } | { status: "error"; message: string } | { status: "ok"; at: number };

export async function updateProfileAction(_prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: "Sign in to edit your profile." };
  const r = await updateProfile(await getDb(), user.id, {
    username: str(formData, "username"),
    displayName: str(formData, "displayName"),
    bio: str(formData, "bio"),
  });
  if (!r.ok) return { status: "error", message: PROFILE_ERROR_MESSAGES[r.error] };
  refresh();
  return { status: "ok", at: Date.now() };
}

/** Deletes the account after the person types their username to confirm. */
export async function deleteAccountAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  if (str(formData, "confirm").trim().replace(/^@/, "").toLowerCase() !== user.username) {
    redirect("/settings/account?error=confirm");
  }
  const deleted = await deleteAccount(await getDb(), user.id);
  if (deleted?.authUserId) {
    try {
      await deleteAuthUser(deleted.authUserId);
    } catch (e) {
      // The Vouch data is already gone; a leftover sign-in identity only recreates an empty profile.
      console.error("[account] auth identity not deleted", e);
    }
  }
  await signOut();
  redirect("/?deleted=1");
}
