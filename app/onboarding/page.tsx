import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/session";
import { groupedTopics, loadTopics } from "@/lib/topics";
import { formatDuration } from "@/lib/format";
import {
  MAX_TOPICS,
  MIN_TOPICS,
  ONBOARDING_ERROR_MESSAGES,
  choicePairs,
  suggestions,
  userTopicSlugs,
  type OnboardingError,
} from "@/lib/onboarding";
import { onboardingChoicesAction, onboardingFinishAction, onboardingTopicsAction } from "@/app/actions";

export const metadata: Metadata = { title: "Welcome" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STEPS = ["Topics", "Quick choices", "People and lists"] as const;

export default function OnboardingPage(props: PageProps<"/onboarding">) {
  return (
    <Suspense fallback={<p className="intro">Loading…</p>}>
      <Onboarding {...props} />
    </Suspense>
  );
}

function Progress({ step }: { step: number }) {
  return (
    <ol className="steps" aria-label="Setup progress">
      {STEPS.map((s, i) => (
        <li key={s} aria-current={i === step ? "step" : undefined} className={i < step ? "done" : undefined}>
          {s}
        </li>
      ))}
    </ol>
  );
}

async function Onboarding({ searchParams }: PageProps<"/onboarding">) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  if (user.onboarded_at) redirect("/");
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) as string | undefined;
  const step = one("step");
  const db = await getDb();

  if (step === "choices") {
    const pairs = await choicePairs(db, user.id);
    return (
      <>
        <Progress step={1} />
        <h1>Which would you rather watch?</h1>
        <p className="intro">
          {pairs.length
            ? "Pick one from each pair, or skip any. Your picks decide which people and lists we suggest next."
            : "There aren't enough videos in your topics yet to compare. You can still follow people and lists on the next step."}
        </p>
        <form action={onboardingChoicesAction} className="stack">
          {pairs.map((pair, i) => (
            <fieldset key={i} className="pair">
              <legend className="eyebrow">Choice {i + 1} of {pairs.length}</legend>
              {pair.map((o) => (
                <label key={o.resourceId} className="pair-option">
                  <input type="radio" name={`pair-${i}`} value={o.resourceId} />
                  <span className="pair-card">
                    {o.thumbnailUrl && <Image className="thumb" src={o.thumbnailUrl} alt="" width={320} height={180} />}
                    <strong>{o.title}</strong>
                    <small>
                      {[o.creatorName, formatDuration(o.durationS)].filter(Boolean).join(" · ")}
                    </small>
                    <small>Vouched by {o.curatorName}{o.note ? `: “${o.note}”` : ""}</small>
                  </span>
                </label>
              ))}
            </fieldset>
          ))}
          <div className="actions">
            <button className="button">Continue</button>
            <Link className="button ghost" href="/onboarding">Back to topics</Link>
          </div>
        </form>
      </>
    );
  }

  if (step === "follow") {
    const picks = (one("picks") ?? "").split(",").filter((p) => UUID.test(p));
    const list = await suggestions(db, user.id, picks);
    return (
      <>
        <Progress step={2} />
        <h1>Start with these</h1>
        <p className="intro">
          {list.length
            ? "Your Circle is built from the people you follow. Lists add a next video to watch, in order. Untick anything you don't want."
            : "Nobody has vouched for videos in your topics yet. You can find people later from the People page."}
        </p>
        <form action={onboardingFinishAction} className="stack">
          {list.length > 0 && (
            <ul className="people">
              {list.map((s) => (
                <li key={`${s.kind}-${s.id}`}>
                  <label className="check grow">
                    <input type="checkbox" name={s.kind} value={s.id} defaultChecked />
                    <span>
                      <strong>{s.name}</strong> <span className="trust-tag">{s.kind === "curator" ? "Person" : "List"}</span>
                      <small>{s.reason}</small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="actions">
            <button className="button">Go to my Circle</button>
            <Link className="button ghost" href="/onboarding?step=choices">Back</Link>
          </div>
        </form>
      </>
    );
  }

  const [topics, mine] = await Promise.all([loadTopics(db), userTopicSlugs(db, user.id)]);
  const error = one("error") as OnboardingError | undefined;
  return (
    <>
      <Progress step={0} />
      <h1>Welcome, {user.display_name.split(" ")[0]}</h1>
      <p className="intro">
        Vouch shows you videos that people you trust think are worth your time. Pick {MIN_TOPICS} to {MAX_TOPICS} topics
        to start. This takes about a minute.
      </p>
      <form action={onboardingTopicsAction} className="stack">
        <fieldset className="field">
          <legend>Topics <span className="trust-tag">(pick {MIN_TOPICS} to {MAX_TOPICS})</span></legend>
          {groupedTopics(topics).map((g) => (
            <div key={g.root.slug} className="topic-group">
              <p className="eyebrow">{g.root.name}</p>
              <div className="chips">
                {g.topics.map((t) => (
                  <label key={t.slug} className="chip">
                    <input type="checkbox" name="topics" value={t.slug} defaultChecked={mine.includes(t.slug)} />
                    <span>{t.name}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </fieldset>
        {error && ONBOARDING_ERROR_MESSAGES[error] && <p className="error" role="alert">{ONBOARDING_ERROR_MESSAGES[error]}</p>}
        <div className="actions">
          <button className="button">Continue</button>
        </div>
      </form>
    </>
  );
}
