/** Month arithmetic for the Hacker News pipeline. Months are "YYYY-MM", always UTC. */

export const FIRST_MONTH = "2025-01";
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isMonth = (m: string) => MONTH.test(m);

export function monthOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function addMonths(m: string, n: number): string {
  const [y, mo] = m.split("-").map(Number);
  return monthOf(new Date(Date.UTC(y, mo - 1 + n, 1)));
}

/** Inclusive range. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** True once the whole month is over. */
export const monthEnded = (m: string, now: Date) => addMonths(m, 1) <= monthOf(now);

/**
 * What a scheduled run should (re)process: every finished month since FIRST_MONTH without
 * verdicts, plus last month and this month, which still collect late comments. Classification
 * skips comments it has already judged, so re-running a month only pays for what is new.
 */
export function pendingMonths(have: Iterable<string>, now: Date, first = FIRST_MONTH): string[] {
  const done = new Set(have);
  const current = monthOf(now);
  const last = addMonths(current, -1);
  const missing = monthsBetween(first, last).filter((m) => !done.has(m));
  return [...new Set([...missing, last, current])].filter((m) => m >= first).sort();
}
