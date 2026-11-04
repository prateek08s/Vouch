import type { Db } from "@/lib/db";
import { loadTopics } from "@/lib/topics";
import { curatorSuccess, topicLevels, type AttributedRating, type CuratorSuccess, type PassportTopic, type TopicSignal } from "./model";

export * from "./model";

/**
 * Taste Passport (plan 7). Private by default. The owner's view uses their vouches and their
 * Worth-It ratings; the public view uses vouches only, because ratings are private (plan 31).
 */

export type Passport = {
  user: { id: string; username: string; displayName: string };
  /** Null until there is enough activity to describe a taste. */
  topics: PassportTopic[] | null;
  /** Null when hidden from the public view. */
  success: CuratorSuccess | null;
  vouchCount: number;
  settings: { isPublic: boolean; showSuccess: boolean };
  view: "owner" | "public";
};

type UserRow = { id: string; username: string; display_name: string; passport_public: boolean; passport_show_success: boolean; is_system: boolean };

async function build(db: Db, u: UserRow, view: Passport["view"], now: Date): Promise<Passport> {
  const index = await loadTopics(db);
  const names = new Map([...index.byId.values()].map((t) => [t.id, t.name]));

  const vouchSignals = await db.query<{ topic_id: number; at: Date }>(
    `select vt.topic_id, v.created_at as at from vouches v join vouch_topics vt on vt.vouch_id = v.id where v.user_id = $1`,
    [u.id],
  );
  const signals: TopicSignal[] = vouchSignals.map((r) => ({ topicId: r.topic_id, kind: "vouch", at: r.at }));
  if (view === "owner") {
    const worth = await db.query<{ topic_id: number; at: Date }>(
      `select rt.topic_id, r.updated_at as at from ratings r join resource_topics rt on rt.resource_id = r.resource_id
       where r.user_id = $1 and r.worth_it`,
      [u.id],
    );
    signals.push(...worth.map((r) => ({ topicId: r.topic_id, kind: "worth" as const, at: r.at })));
  }

  let success: CuratorSuccess | null = null;
  if (view === "owner" || u.passport_show_success) {
    // Other people's ratings of videos they reached through this person's vouches. Counts only.
    const rows = await db.query<{ rater_id: string; worth_it: boolean; topic_ids: number[] }>(
      `select r.user_id as rater_id, r.worth_it,
              coalesce(array_agg(vt.topic_id) filter (where vt.topic_id is not null), '{}') as topic_ids
       from ratings r
       join vouches v on v.id = r.attribution_vouch_id
       left join vouch_topics vt on vt.vouch_id = v.id
       where v.user_id = $1 and r.user_id <> $1
       group by r.user_id, r.resource_id, r.worth_it`,
      [u.id],
    );
    const ratings: AttributedRating[] = rows.map((r) => ({ raterId: r.rater_id, worthIt: r.worth_it, topicIds: r.topic_ids }));
    success = curatorSuccess(ratings, names);
  }

  return {
    user: { id: u.id, username: u.username, displayName: u.display_name },
    topics: topicLevels(signals, names, now),
    success,
    vouchCount: (await db.query<{ n: number }>("select count(*)::int n from vouches where user_id = $1", [u.id]))[0].n,
    settings: { isPublic: u.passport_public, showSuccess: u.passport_show_success },
    view,
  };
}

const USER_COLS = "id, username, display_name, passport_public, passport_show_success, is_system";

export async function ownPassport(db: Db, userId: string, now = new Date()): Promise<Passport | null> {
  const [u] = await db.query<UserRow>(`select ${USER_COLS} from users where id = $1`, [userId]);
  return u ? build(db, u, "owner", now) : null;
}

/** Null unless the person made their Passport public. System curators have no Passport. */
export async function publicPassport(db: Db, username: string, now = new Date()): Promise<Passport | null> {
  const [u] = await db.query<UserRow>(`select ${USER_COLS} from users where username = $1`, [username.trim().toLowerCase()]);
  if (!u || u.is_system || !u.passport_public) return null;
  return build(db, u, "public", now);
}

/** Saves the privacy choices. Making it public is recorded as passport_shared (plan 20). */
export async function setPassportSettings(
  db: Db,
  userId: string,
  settings: { isPublic: boolean; showSuccess: boolean },
  now = new Date(),
): Promise<void> {
  const [before] = await db.query<{ passport_public: boolean }>(
    `update users u set passport_public = $2, passport_show_success = $3
     from (select passport_public from users where id = $1) old
     where u.id = $1 returning old.passport_public`,
    [userId, settings.isPublic, settings.showSuccess],
  );
  if (before && !before.passport_public && settings.isPublic) {
    await db.query("insert into events (user_id, name, props, created_at) values ($1, 'passport_shared', '{}', $2)", [userId, now]);
  }
}
