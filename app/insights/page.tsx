import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/session";
import { impressionReport } from "@/lib/analytics";

export const metadata: Metadata = { title: "Insights" };

/**
 * Totals for the MVP hypotheses (plan 26): for each place a recommendation appeared and each
 * "Why this?" explanation, how often it was opened and rated Worth It. Totals only, never
 * per person. Development only until there is real admin access.
 */
export default function InsightsPage() {
  return (
    <>
      <h1>Insights</h1>
      <p className="intro">
        How recommendations perform, by where they were shown and how they were explained. Totals across everyone; no one&apos;s
        individual ratings appear here.
      </p>
      <Suspense fallback={<p>Loading…</p>}>
        <Report />
      </Suspense>
    </>
  );
}

const SOURCE: Record<string, string> = { circle: "Circle", list: "List up next", search: "Search" };
const EXPLANATION: Record<string, string> = {
  circle_topic_trust: "Topic trust (“You rated 3 of Priya’s 3 AI picks…”)",
  circle_base_trust: "Overall trust",
  circle_follow: "Just followed",
  list_next: "Next in a followed list",
  search_circle: "Search, vouched by your circle",
  search_match: "Search, other vouches",
};
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "–");

async function Report() {
  if (process.env.NODE_ENV === "production") notFound();
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const rows = await impressionReport(await getDb());
  if (!rows.length) return <p className="empty">Nothing has been shown yet. Open the Circle, a list or search to start collecting.</p>;
  return (
    <table className="insights">
      <thead>
        <tr>
          <th scope="col">Shown in</th>
          <th scope="col">Explanation</th>
          <th scope="col">Shown</th>
          <th scope="col">Opened</th>
          <th scope="col">Rated</th>
          <th scope="col">Worth it</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.source}-${r.explanation}`}>
            <td>{SOURCE[r.source] ?? r.source}</td>
            <td>{EXPLANATION[r.explanation] ?? r.explanation}</td>
            <td>{r.shown}</td>
            <td>{r.opened} <small>({pct(r.opened, r.shown)})</small></td>
            <td>{r.rated}</td>
            <td>{r.worthIt} <small>({pct(r.worthIt, r.rated)} of rated)</small></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
