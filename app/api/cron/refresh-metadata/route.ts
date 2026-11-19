import { getDb } from "@/lib/server/db";
import { refreshStaleMetadata } from "@/lib/resources/refresh";
import { defaultMetadataProvider } from "@/lib/youtube/metadata";
import { pruneAnonEvents } from "@/lib/experiment";

export const maxDuration = 60;

/**
 * Daily YouTube metadata refresh (vercel.json crons). Vercel sends CRON_SECRET as a bearer token;
 * anyone else gets 401. 200 videos a day covers the whole catalogue well inside 30 days.
 * Also deletes anonymous browser events older than 90 days.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const db = await getDb();
  const stats = await refreshStaleMetadata(db, defaultMetadataProvider(), { limit: 200, concurrency: 6 });
  const prunedAnonEvents = await pruneAnonEvents(db);
  console.log(JSON.stringify({ event: "metadata_refresh", ...stats, prunedAnonEvents }));
  return Response.json({ ...stats, prunedAnonEvents }, { headers: { "Cache-Control": "no-store" } });
}
