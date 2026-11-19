"use server";
import { authConfigured, authProviders, siteOrigin } from "@/lib/auth/config";
import { authClient } from "@/lib/auth/client";
import { redirect } from "next/navigation";
import { signOut } from "@/lib/server/session";
import { str } from "@/lib/server/form";

export async function signOutAction() {
  await signOut();
  redirect("/signin");
}

export async function oauthSignIn(formData: FormData) {
  if (!authConfigured()) redirect("/signin?error=configuration");
  const provider = authProviders().find((p) => p === str(formData, "provider"));
  if (!provider) redirect("/signin");
  const { data, error } = await (await authClient()).auth.signInWithOAuth({
    provider,
    options: { redirectTo: siteOrigin() + "/auth/callback" },
  });
  if (error || !data.url) redirect("/signin?error=oauth");
  redirect(data.url);
}
