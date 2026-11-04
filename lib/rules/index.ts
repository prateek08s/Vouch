import type { Db } from "@/lib/db";
import { normalizeText, type Rule, type RuleKind } from "./engine";

export * from "./engine";

export type StoredRule = Rule & { id: string; created_at: Date };
export type RuleError = "invalid_value" | "unknown_topic" | "min_exceeds_max" | "too_many_rules";

export const MAX_RULES = 200;

/**
 * Creates a rule. Durations are given in minutes and stored as seconds.
 * There is at most one min and one max duration: setting a new one replaces it.
 */
export async function createRule(
  db: Db,
  userId: string,
  kind: RuleKind,
  rawValue: string,
): Promise<{ ok: true; rule: StoredRule } | { ok: false; error: RuleError }> {
  let value: string;
  switch (kind) {
    case "channel":
      value = rawValue.trim();
      if (!value || value.length > 200) return { ok: false, error: "invalid_value" };
      break;
    case "topic": {
      value = rawValue.trim().toLowerCase();
      const t = await db.query("select 1 from topics where slug = $1", [value]);
      if (!t.length) return { ok: false, error: "unknown_topic" };
      break;
    }
    case "keyword":
      value = normalizeText(rawValue);
      if (value.length < 2 || value.length > 50) return { ok: false, error: "invalid_value" };
      break;
    case "min_duration":
    case "max_duration": {
      const minutes = Number(rawValue);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 600) return { ok: false, error: "invalid_value" };
      value = String(minutes * 60);
      break;
    }
    case "no_shorts":
      value = "";
      break;
    default:
      return { ok: false, error: "invalid_value" };
  }

  return db.transaction(async (tx) => {
    await tx.query("select id from users where id = $1 for update", [userId]);
    if (kind === "min_duration" || kind === "max_duration") {
      const otherKind = kind === "min_duration" ? "max_duration" : "min_duration";
      const [other] = await tx.query<{ value: string }>("select value from rules where user_id = $1 and kind = $2", [userId, otherKind]);
      if (other) {
        const [min, max] = kind === "min_duration" ? [Number(value), Number(other.value)] : [Number(other.value), Number(value)];
        if (min > max) return { ok: false, error: "min_exceeds_max" } as const;
      }
    }
    const [{ n }] = await tx.query<{ n: number }>("select count(*)::int n from rules where user_id = $1", [userId]);
    if (n >= MAX_RULES) return { ok: false, error: "too_many_rules" } as const;
    if (kind === "min_duration" || kind === "max_duration") {
      await tx.query("delete from rules where user_id = $1 and kind = $2", [userId, kind]);
    }
    const rows = await tx.query<StoredRule>(
      `insert into rules (user_id, kind, value) values ($1, $2, $3)
       on conflict (user_id, kind, value) do update set kind = excluded.kind
       returning id, kind, value, created_at`,
      [userId, kind, value],
    );
    await tx.query("insert into events (user_id, name, props) values ($1, 'rule_created', $2)", [
      userId,
      JSON.stringify({ kind }),
    ]);
    return { ok: true, rule: rows[0] } as const;
  });
}

export async function listRules(db: Db, userId: string): Promise<StoredRule[]> {
  return db.query<StoredRule>(
    "select id, kind, value, created_at from rules where user_id = $1 order by created_at",
    [userId],
  );
}

export async function deleteRule(db: Db, userId: string, ruleId: string): Promise<boolean> {
  const rows = await db.query("delete from rules where id = $1 and user_id = $2 returning 1", [ruleId, userId]);
  return rows.length > 0;
}
