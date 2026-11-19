import type { Db } from "@/lib/db";

export const REPORT_REASONS = ["spam", "harassment", "misleading", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REASON_LABEL: Record<ReportReason, string> = {
  spam: "Spam or self-promotion",
  harassment: "Harassment or hate",
  misleading: "Misleading note",
  other: "Something else",
};

export const isReason = (r: string): r is ReportReason => (REPORT_REASONS as readonly string[]).includes(r);

/** One report per person per vouch; reporting again is a no-op. You can't report your own vouch. */
export async function reportVouch(
  db: Db,
  reporterId: string,
  vouchId: string,
  reason: ReportReason,
  details?: string,
): Promise<boolean> {
  const text = details?.trim().slice(0, 500) || null;
  const rows = await db.query<{ id: string }>(
    `insert into reports (reporter_id, vouch_id, reason, details)
     select $1, v.id, $3, $4 from vouches v where v.id = $2 and v.user_id <> $1 and v.hidden_at is null
     on conflict (reporter_id, vouch_id) do nothing
     returning id`,
    [reporterId, vouchId, reason, text],
  );
  return rows.length > 0;
}

export type OpenReport = {
  vouchId: string;
  resourceId: string;
  title: string;
  note: string | null;
  authorId: string;
  authorName: string;
  authorUsername: string;
  authorIsSystem: boolean;
  reports: number;
  reasons: ReportReason[];
  details: string[];
  firstAt: Date;
};

/** Open reports grouped by vouch, most-reported first. */
export async function openReports(db: Db): Promise<OpenReport[]> {
  const rows = await db.query<{
    vouch_id: string; resource_id: string; title: string; note: string | null; author_id: string;
    author_name: string; author_username: string; author_is_system: boolean; reports: number;
    reasons: ReportReason[]; details: string[]; first_at: Date;
  }>(
    `select v.id as vouch_id, v.resource_id, r.title, v.note, u.id as author_id, u.display_name as author_name,
            u.username as author_username, u.is_system as author_is_system, count(*)::int as reports,
            array_agg(distinct rp.reason) as reasons,
            coalesce(array_agg(rp.details) filter (where rp.details is not null), '{}') as details,
            min(rp.created_at) as first_at
     from reports rp
     join vouches v on v.id = rp.vouch_id
     join resources r on r.id = v.resource_id
     join users u on u.id = v.user_id
     where rp.resolved_at is null
     group by v.id, r.id, u.id
     order by count(*) desc, min(rp.created_at)
     limit 100`,
  );
  return rows.map((r) => ({
    vouchId: r.vouch_id, resourceId: r.resource_id, title: r.title, note: r.note, authorId: r.author_id,
    authorName: r.author_name, authorUsername: r.author_username, authorIsSystem: r.author_is_system,
    reports: r.reports, reasons: r.reasons, details: r.details, firstAt: r.first_at,
  }));
}

/** Hides a vouch (it leaves every feed, page and the search index) and closes its reports. */
export async function hideVouch(db: Db, adminId: string, vouchId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query("update vouches set hidden_at = coalesce(hidden_at, now()) where id = $1", [vouchId]);
    await tx.query(
      `update reports set resolved_at = now(), resolution = 'hidden', resolved_by = $2
       where vouch_id = $1 and resolved_at is null`,
      [vouchId, adminId],
    );
  });
}

/** Closes a vouch's open reports and leaves the vouch up. */
export async function dismissReports(db: Db, adminId: string, vouchId: string): Promise<void> {
  await db.query(
    `update reports set resolved_at = now(), resolution = 'dismissed', resolved_by = $2
     where vouch_id = $1 and resolved_at is null`,
    [vouchId, adminId],
  );
}

/**
 * Suspends an account: it can no longer sign in to Vouch, drops off People and profiles,
 * and every vouch it made is hidden. System curators and admins can't be suspended here.
 */
export async function suspendUser(db: Db, adminId: string, userId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const done = await tx.query<{ id: string }>(
      `update users set suspended_at = now()
       where id = $1 and not is_system and not is_admin and suspended_at is null returning id`,
      [userId],
    );
    if (!done.length) return false;
    await tx.query("update vouches set hidden_at = now() where user_id = $1 and hidden_at is null", [userId]);
    await tx.query(
      `update reports rp set resolved_at = now(), resolution = 'hidden', resolved_by = $2
       from vouches v where v.id = rp.vouch_id and v.user_id = $1 and rp.resolved_at is null`,
      [userId, adminId],
    );
    return true;
  });
}
