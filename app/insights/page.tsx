import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/session";
import { impressionReport } from "@/lib/analytics";
import { experimentOn, experimentReport, type VariantReport } from "@/lib/experiment";

export const metadata: Metadata = { title: "Insights" };

/**
 * Totals for the MVP hypotheses (plan 26): for each place a recommendation appeared and each
 * "Why this?" explanation, how often it was opened and rated Worth It. Totals only, never
 * per person. Admins only in production (users.is_admin).
 */
export default function InsightsPage() {
  return (
    <>
      <header className="page-head">
        <h1>Insights</h1>
        <p>
          How recommendations perform, by where they were shown and how they were explained. Totals across everyone; no
          one&apos;s individual ratings appear here.
        </p>
      </header>
      <Suspense fallback={<p className="muted">Loading…</p>}>
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
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  // Admins only in production; anyone signed in during development.
  if (!user.is_admin && process.env.NODE_ENV === "production") notFound();
  const db = await getDb();
  const [rows, experiment] = await Promise.all([impressionReport(db), experimentReport(db)]);
  return (
    <>
      <Experiment rows={experiment} />
      <h2 className="section-title">Signed-in recommendations</h2>
      {rows.length ? <SignedIn rows={rows} /> : (
        <div className="empty">
          <strong>Nothing has been shown to signed-in people yet.</strong>
          <p>Lists and search start collecting as soon as someone signs in.</p>
        </div>
      )}
    </>
  );
}

/**
 * The note experiment (critique): visitors by browser, what they saw and did, per variant.
 * Success needs a higher open rate with the note and a 40% return rate.
 */
function Experiment({ rows }: { rows: VariantReport[] }) {
  const label = { note: "With the HN comment", nonote: "Without it" } as const;
  return (
    <section className="section" aria-labelledby="exp-h">
      <h2 id="exp-h" className="section-title">Browsers (signed in or not)</h2>
      <p className="section-note">
        {experimentOn()
          ? "The note experiment is running: half of browsers see picks without the Hacker News comment."
          : "The note experiment is off (VOUCH_NOTE_EXPERIMENT), so every browser sees the comment."}{" "}
        Returning means active on two or more days. Events are deleted after 90 days.
      </p>
      <div className="table-wrap">
        <table className="insights">
          <thead>
            <tr>
              <th scope="col">Cards</th>
              <th scope="col">Browsers</th>
              <th scope="col">Returning</th>
              <th scope="col">Shown</th>
              <th scope="col">Opened</th>
              <th scope="col">Rated</th>
              <th scope="col">Worth it</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.variant}>
                <td>{label[r.variant]}</td>
                <td className="num">{r.visitors}</td>
                <td className="num">{r.returning} <small>({pct(r.returning, r.visitors)})</small></td>
                <td className="num">{r.shown}</td>
                <td className="num">{r.opened} <small>({pct(r.opened, r.shown)})</small></td>
                <td className="num">{r.worth + r.notWorth}</td>
                <td className="num">{r.worth} <small>({pct(r.worth, r.worth + r.notWorth)} of rated)</small></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SignedIn({ rows }: { rows: Awaited<ReturnType<typeof impressionReport>> }) {
  return (
    <div className="table-wrap">
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
              <td className="num">{r.shown}</td>
              <td className="num">{r.opened} <small>({pct(r.opened, r.shown)})</small></td>
              <td className="num">{r.rated}</td>
              <td className="num">{r.worthIt} <small>({pct(r.worthIt, r.rated)} of rated)</small></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
