"use server";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/session";
import { completeOnboarding, saveTopics } from "@/lib/onboarding";
import { UUID } from "@/lib/server/form";

export async function onboardingTopicsAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const topics = formData.getAll("topics").filter((t): t is string => typeof t === "string");
  const r = await saveTopics(await getDb(), user.id, topics);
  if (!r.ok) redirect(`/onboarding?error=${r.error}`);
  redirect("/onboarding?step=choices");
}

export async function onboardingChoicesAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const picks = [...formData.entries()]
    .filter(([k, v]) => k.startsWith("pair-") && typeof v === "string" && UUID.test(v))
    .map(([, v]) => v as string);
  redirect(`/onboarding?step=follow${picks.length ? `&picks=${picks.join(",")}` : ""}`);
}

export async function onboardingFinishAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const ids = (k: string) => formData.getAll(k).filter((v): v is string => typeof v === "string" && UUID.test(v));
  await completeOnboarding(await getDb(), user.id, { curatorIds: ids("curator"), listIds: ids("list") });
  redirect("/");
}
