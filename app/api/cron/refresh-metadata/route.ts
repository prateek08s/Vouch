import { getDb } from "@/lib/server/db";
import { refreshStaleMetadata } from "@/lib/resources/refresh";
import { defaultMetadataProvider } from "@/lib/youtube/metadata";

export const maxDuration = 60;

/**
 * Daily YouTube metadata refresh (vercel.json crons). Vercel sends CRON_SECRET as a bearer token;
 * anyone else gets 401. 200 videos a day covers the whole catalogue well inside 30 days.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const stats = await refreshStaleMetadata(await getDb(), defaultMetadataProvider(), { limit: 200, concurrency: 6 });
  console.log(JSON.stringify({ event: "metadata_refresh", ...stats }));
  return Response.json(stats, { headers: { "Cache-Control": "no-store" } });
}
