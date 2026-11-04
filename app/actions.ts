"use server";
import { authConfigured, demoAuthAllowed, siteOrigin } from "@/lib/auth/config";
import { authClient } from "@/lib/auth/client";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/server/db";
import { getCurrentUser, signIn, signOut } from "@/lib/server/session";
import { ingestYouTubeUrl, INGEST_ERROR_MESSAGES } from "@/lib/resources/ingest";
import { createVouch, VOUCH_ERROR_MESSAGES } from "@/lib/vouches";
import { rate, recordOpen } from "@/lib/ratings";
import { follow, unfollow } from "@/lib/graph/follows";
import { defaultMetadataProvider } from "@/lib/youtube/metadata";
import { createUser, getUserByUsername, usernameFrom } from "@/lib/users";
import { completeOnboarding, saveTopics } from "@/lib/onboarding";
import { createRule, deleteRule, type RuleKind } from "@/lib/rules";
import { RULE_ERROR_MESSAGES } from "@/lib/rules/describe";
import {
  LIST_ERROR_MESSAGES,
  addToList,
  createList,
  deleteList,
  followList,
  moveItem,
  removeFromList,
  unfollowList,
} from "@/lib/lists";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v : "";
};

export async function signInAs(formData: FormData) {
  if (!demoAuthAllowed()) redirect("/signin");
  const db = await getDb();
  const user = await getUserByUsername(db, str(formData, "username"));
  // System curators (such as "Hacker News") are not accounts anyone can use.
  if (!user || user.is_system) redirect("/signin?error=unknown");
  await signIn(user.id);
  redirect("/");
}

/** Development sign-up: a new account with only a name, sent straight to onboarding. */
export async function createAccountAction(formData: FormData) {
  if (!demoAuthAllowed()) redirect("/signin");
  const name = str(formData, "name").trim().replace(/\s+/g, " ");
  if (!name || name.length > 60) redirect("/signin?error=name");
  const db = await getDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = String(Math.floor(1000 + Math.random() * 9000));
    const r = await createUser(db, { username: usernameFrom(name, suffix), displayName: name });
    if (r.ok) {
      await signIn(r.user.id);
      redirect("/onboarding");
    }
    if (r.error !== "username_taken") redirect("/signin?error=name");
  }
  redirect("/signin?error=name");
}

export async function onboardingTopicsAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const topics = formData.getAll("topics").filter((t): t is string => typeof t === "string");
  const r = await saveTopics(await getDb(), user.id, topics);
  if (!r.ok) redirect(`/onboarding?error=${r.error}`);
  redirect("/onboarding?step=choices");
}

export async function onboardingChoicesAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const picks = [...formData.entries()]
    .filter(([k, v]) => k.startsWith("pair-") && typeof v === "string" && UUID.test(v))
    .map(([, v]) => v as string);
  redirect(`/onboarding?step=follow${picks.length ? `&picks=${picks.join(",")}` : ""}`);
}

export async function onboardingFinishAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const ids = (k: string) => formData.getAll(k).filter((v): v is string => typeof v === "string" && UUID.test(v));
  await completeOnboarding(await getDb(), user.id, { curatorIds: ids("curator"), listIds: ids("list") });
  redirect("/");
}

export async function signOutAction() {
  await signOut();
  redirect("/signin");
}

export type VouchState =
  | { status: "idle" }
  | { status: "error"; message: string; field?: "url" | "note" | "topics" }
  | { status: "ok"; title: string; resourceId: string };

export async function vouchAction(_prev: VouchState, formData: FormData): Promise<VouchState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: "Sign in to vouch." };
  const db = await getDb();

  const ingested = await ingestYouTubeUrl(str(formData, "url"), { db, metadata: defaultMetadataProvider() });
  if (!ingested.ok) return { status: "error", field: "url", message: INGEST_ERROR_MESSAGES[ingested.error] };

  const topics = formData.getAll("topics").filter((t): t is string => typeof t === "string");
  const res = await createVouch(
    {
      userId: user.id,
      resourceId: ingested.resource.id,
      note: str(formData, "note"),
      topicSlugs: topics,
      isOwnContent: formData.get("own") === "on",
    },
    { db },
  );
  if (!res.ok) {
    const field = res.error === "note_too_long" ? "note" : res.error.includes("topic") ? "topics" : undefined;
    return { status: "error", field, message: VOUCH_ERROR_MESSAGES[res.error] };
  }
  refresh();
  return { status: "ok", title: ingested.resource.title, resourceId: ingested.resource.id };
}

export async function rateAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const resourceId = str(formData, "resourceId");
  const via = str(formData, "via");
  const verdict = str(formData, "verdict");
  if (!UUID.test(resourceId) || (verdict !== "worth" && verdict !== "not")) return;

  const db = await getDb();
  // Attribution first, so the curator who brought the viewer here gets the credit.
  await recordOpen(db, { userId: user.id, resourceId, vouchId: UUID.test(via) ? via : null });
  await rate({ userId: user.id, resourceId, worthIt: verdict === "worth" }, { db });
  refresh();
}

export async function followAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const target = str(formData, "userId");
  if (!UUID.test(target)) return;
  const db = await getDb();
  if (str(formData, "op") === "unfollow") await unfollow(db, user.id, target);
  else await follow(db, user.id, target);
  refresh();
}

export type RuleState = { status: "idle" } | { status: "error"; message: string } | { status: "ok"; at: number };

const RULE_KINDS: RuleKind[] = ["channel", "topic", "keyword", "min_duration", "max_duration", "no_shorts"];

export async function addRuleAction(_prev: RuleState, formData: FormData): Promise<RuleState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: "Sign in to set rules." };
  const kind = str(formData, "kind") as RuleKind;
  if (!RULE_KINDS.includes(kind)) return { status: "error", message: RULE_ERROR_MESSAGES.invalid_value };
  const r = await createRule(await getDb(), user.id, kind, str(formData, "value"));
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

/** Plan flow C: "Never show this channel" from a video, then confirm with an undo on the Circle. */
export async function blockChannelAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const resourceId = str(formData, "resourceId");
  if (!UUID.test(resourceId)) return;
  const db = await getDb();
  const [res] = await db.query<{ creator_external_id: string | null }>(
    "select creator_external_id from resources where id = $1",
    [resourceId],
  );
  if (!res?.creator_external_id) return;
  const r = await createRule(db, user.id, "channel", res.creator_external_id);
  if (r.ok) redirect(`/?blocked=${r.rule.id}`);
}

export type ListFormState = { status: "idle" } | { status: "error"; message: string };

export async function createListAction(_prev: ListFormState, formData: FormData): Promise<ListFormState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: "Sign in to make a list." };
  const r = await createList(await getDb(), user.id, {
    title: str(formData, "title"),
    description: str(formData, "description"),
    isPublic: formData.get("private") !== "on",
  });
  if (!r.ok) return { status: "error", message: LIST_ERROR_MESSAGES[r.error] };
  redirect(`/lists/${r.list.id}`);
}

export type AddToListState = { status: "idle" } | { status: "error"; message: string } | { status: "ok"; listTitle: string; listId: string };

export async function addToListAction(_prev: AddToListState, formData: FormData): Promise<AddToListState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: "Sign in first." };
  const listId = str(formData, "listId");
  const resourceId = str(formData, "resourceId");
  if (!UUID.test(listId) || !UUID.test(resourceId)) return { status: "error", message: "Choose a list." };
  const db = await getDb();
  const r = await addToList(db, user.id, listId, resourceId, str(formData, "note"));
  if (!r.ok) return { status: "error", message: LIST_ERROR_MESSAGES[r.error] };
  const [l] = await db.query<{ title: string }>("select title from lists where id = $1", [listId]);
  return { status: "ok", listTitle: l?.title ?? "your list", listId };
}

export async function listItemAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const listId = str(formData, "listId");
  const resourceId = str(formData, "resourceId");
  if (!UUID.test(listId) || !UUID.test(resourceId)) return;
  const db = await getDb();
  const op = str(formData, "op");
  if (op === "remove") await removeFromList(db, user.id, listId, resourceId);
  else if (op === "move") await moveItem(db, user.id, listId, resourceId, Number(str(formData, "to")));
  refresh();
}

export async function followListAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const listId = str(formData, "listId");
  if (!UUID.test(listId)) return;
  const db = await getDb();
  if (str(formData, "op") === "unfollow") await unfollowList(db, user.id, listId);
  else await followList(db, user.id, listId);
  refresh();
}

export async function deleteListAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const listId = str(formData, "listId");
  if (UUID.test(listId)) await deleteList(await getDb(), user.id, listId);
  redirect("/lists");
}

export async function oauthSignIn(formData: FormData) {
  if (!authConfigured()) redirect("/signin?error=configuration");
  const provider = str(formData, "provider");
  if (provider !== "google" && provider !== "github") redirect("/signin");
  const { data, error } = await (await authClient()).auth.signInWithOAuth({
    provider,
    options: { redirectTo: siteOrigin() + "/auth/callback" },
  });
  if (error || !data.url) redirect("/signin?error=oauth");
  redirect(data.url);
}