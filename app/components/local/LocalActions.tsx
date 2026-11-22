"use client";
import { useTransition } from "react";
import { anonRateAction } from "@/app/watch/actions";
import { updateLocal, useLocal } from "./store";

/**
 * Kept in this browser. rate=false: the Save and Watched buttons (everyone).
 * rate=true: the Worth-it question, for signed-out visitors.
 */
export function LocalActions({
  resourceId, title, thumb, rate,
}: { resourceId: string; title: string; thumb: string | null; rate: boolean }) {
  const local = useLocal();
  const [, start] = useTransition();
  const saved = Boolean(local.saved[resourceId]);
  const watched = Boolean(local.watched[resourceId]);
  const rating = local.ratings[resourceId];

  const toggleSave = () => updateLocal((s) => {
    if (s.saved[resourceId]) delete s.saved[resourceId];
    else s.saved[resourceId] = { title, thumb, at: Date.now() };
  });
  const toggleWatched = () => updateLocal((s) => {
    if (s.watched[resourceId]) delete s.watched[resourceId];
    else s.watched[resourceId] = Date.now();
  });
  const answer = (worth: boolean) => {
    updateLocal((s) => {
      s.ratings[resourceId] = worth;
    });
    start(() => anonRateAction(resourceId, worth));
  };

  return (
    <>
      {rate && (
        <section className="worth" aria-labelledby="worth-h">
          <h2 id="worth-h">Was this worth your time?</h2>
          <div className="verdicts">
            <button type="button" className="verdict yes" aria-pressed={rating === true} onClick={() => answer(true)}>Worth it</button>
            <button type="button" className="verdict no" aria-pressed={rating === false} onClick={() => answer(false)}>Not worth it</button>
          </div>
          {rating === undefined ? (
            <p>No account needed. Your answer stays in this browser and is counted anonymously.</p>
          ) : (
            <p className="done" role="status">{rating ? "Marked Worth it." : "Marked Not worth it."}</p>
          )}
        </section>
      )}
      {!rate && <div className="local-tools">
        <button type="button" className="button ghost small" aria-pressed={saved} onClick={toggleSave}>
          {saved ? "Saved" : "Save for later"}
        </button>
        <button type="button" className="button ghost small" aria-pressed={watched} onClick={toggleWatched}>
          {watched ? "Watched" : "Mark as watched"}
        </button>
      </div>}
    </>
  );
}
