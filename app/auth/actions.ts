"use server";
import { authConfigured, authProviders, emailSignIn, siteOrigin } from "@/lib/auth/config";
import { allow } from "@/lib/limits";
import { getDb } from "@/lib/server/db";
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

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EmailState = { status: "idle" } | { status: "sent"; email: string } | { status: "error"; message: string };

/** Sends a one-time sign-in link. The link lands on /auth/callback like OAuth does. */
export async function emailSignInAction(_prev: EmailState, formData: FormData): Promise<EmailState> {
  if (!authConfigured() || !emailSignIn()) return { status: "error", message: "Email sign-in isn’t available." };
  const email = str(formData, "email").trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) return { status: "error", message: "Enter a valid email address." };
  if (!(await allow(await getDb(), "ingest", `email:${email}`))) {
    return { status: "error", message: "Too many links requested. Wait a few minutes and try again." };
  }
  const { error } = await (await authClient()).auth.signInWithOtp({
    email,
    options: { emailRedirectTo: siteOrigin() + "/auth/callback", shouldCreateUser: true },
  });
  if (error) return { status: "error", message: "We couldn’t send the link. Try again in a minute." };
  return { status: "sent", email };
}
