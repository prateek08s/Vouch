import { socialEnabled } from "@/lib/flags";
import { NextResponse, type NextRequest } from "next/server";
import { authClient } from "@/lib/auth/client";
import { siteOrigin } from "@/lib/auth/config";
import { ensureProfile } from "@/lib/auth/profile";
import { getDb } from "@/lib/server/db";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const client = await authClient();
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data: { user } } = await client.auth.getUser();
      if (user) {
        const profile = await ensureProfile(await getDb(), user);
        return NextResponse.redirect(new URL(profile.onboarded_at || !socialEnabled() ? "/" : "/onboarding", siteOrigin()), {
          headers: { "Cache-Control": "private, no-store" },
        });
      }
    }
  }
  return NextResponse.redirect(new URL("/signin?error=oauth", siteOrigin()));
}
