"use server";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/session";
import { setPassportSettings } from "@/lib/passport";

/** Taste Passport privacy: private by default; sharing is the person's choice (plan 7, 31). */
export async function passportSettingsAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  await setPassportSettings(await getDb(), user.id, {
    isPublic: formData.get("public") === "on",
    showSuccess: formData.get("success") === "on",
  });
  refresh();
}
