"use server";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/server/db";
import { allow, LIMIT_MESSAGE } from "@/lib/limits";
import { getCurrentUser } from "@/lib/server/session";
import { createRule, deleteRule, type RuleKind } from "@/lib/rules";
import { RULE_ERROR_MESSAGES } from "@/lib/rules/describe";
import { UUID, str } from "@/lib/server/form";

export type RuleState = { status: "idle" } | { status: "error"; message: string } | { status: "ok"; at: number };

const RULE_KINDS: RuleKind[] = ["channel", "topic", "keyword", "min_duration", "max_duration", "no_shorts"];

export async function addRuleAction(_prev: RuleState, formData: FormData): Promise<RuleState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: "Sign in to set rules." };
  const kind = str(formData, "kind") as RuleKind;
  if (!RULE_KINDS.includes(kind)) return { status: "error", message: RULE_ERROR_MESSAGES.invalid_value };
  const db = await getDb();
  if (!(await allow(db, "write", user.id))) return { status: "error", message: LIMIT_MESSAGE };
  const r = await createRule(db, user.id, kind, str(formData, "value"));
  if (!r.ok) return { status: "error", message: RULE_ERROR_MESSAGES[r.error] };
  refresh();
  return { status: "ok", at: Date.now() };
}

export async function deleteRuleAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const id = str(formData, "ruleId");
  if (UUID.test(id)) await deleteRule(await getDb(), user.id, id);
  const back = str(formData, "back");
  if (back === "circle") redirect("/");
  refresh();
}
