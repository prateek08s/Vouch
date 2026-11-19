import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authConfigured } from "@/lib/auth/config";
import { ANON_COOKIE, ANON_MAX_AGE_S, isAnonId } from "@/lib/experiment";

export async function proxy(request: NextRequest) {
  // A random browser ID for signed-out measurement. Set on the request too, so the first page
  // already sees it.
  const newAnon = isAnonId(request.cookies.get(ANON_COOKIE)?.value) ? null : crypto.randomUUID();
  if (newAnon) request.cookies.set(ANON_COOKIE, newAnon);
  let response = NextResponse.next({ request });
  const finish = (res: NextResponse) => {
    if (newAnon) {
      res.cookies.set(ANON_COOKIE, newAnon, {
        maxAge: ANON_MAX_AGE_S, httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production",
      });
    }
    return res;
  };
  if (!authConfigured()) return finish(response);
  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    } },
  );
  await client.auth.getUser();
  response.headers.set("Cache-Control", "private, no-store");
  return finish(response);
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"] };
