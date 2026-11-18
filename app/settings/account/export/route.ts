import { getDb } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/session";
import { exportAccount } from "@/lib/users/account";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in first.", { status: 401 });
  const data = await exportAccount(await getDb(), user.id);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="vouch-${user.username}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
