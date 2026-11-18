"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { vouchAction, type VouchState } from "@/app/actions";

const NOTE_MAX = 280;
const MAX_TOPICS = 3;

type TopicGroup = { name: string; topics: { slug: string; name: string }[] };

export function VouchComposer({ groups, remaining, limit }: { groups: TopicGroup[]; remaining: number; limit: number }) {
  const [state, action, pending] = useActionState<VouchState, FormData>(vouchAction, { status: "idle" });
  // Controlled, and submitted without a form reset, so a failed submit never loses what was typed.
  const [url, setUrl] = useState("");
  const [own, setOwn] = useState(false);
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  // The success panel is dismissed by remembering which result was already shown.
  const [dismissed, setDismissed] = useState<VouchState | null>(null);

  if (state.status === "ok" && state !== dismissed) {
    return (
      <div className="panel stack" style={{ maxWidth: "38rem" }} role="status">
        <div>
          <p className="success">Vouched.</p>
          <p style={{ marginTop: "0.35rem" }}>
            “{state.title.replace(/[.!?]$/, "")}” will show up in your followers’ Circles.
          </p>
        </div>
        <div className="actions">
          <Link className="button" href={`/watch/${state.resourceId}`}>Open the video</Link>
          <button
            type="button"
            className="button ghost"
            onClick={() => {
              setDismissed(state);
              setUrl("");
              setOwn(false);
              setNote("");
              setPicked([]);
            }}
          >
            Vouch for another
          </button>
        </div>
      </div>
    );
  }

  const toggle = (slug: string) =>
    setPicked((p) => (p.includes(slug) ? p.filter((s) => s !== slug) : p.length < MAX_TOPICS ? [...p, slug] : p));
  const err = state.status === "error" && state !== dismissed ? state : null;
  const used = Math.max(0, limit - remaining);

  return (
    <form
      className="form"
      noValidate
      onSubmit={(e) => {
        // Submit manually: React's automatic post-action form reset would desync the
        // controlled topic chips from what the user sees.
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <div className="quota">
        {limit > 0 && limit <= 12 && (
          <span className="quota-dots" aria-hidden="true">
            {Array.from({ length: limit }, (_, i) => <i key={i} className={i < used ? "used" : undefined} />)}
          </span>
        )}
        <span>
          {remaining > 0
            ? `${remaining} of ${limit} ${limit === 1 ? "vouch" : "vouches"} left today. A small daily limit keeps each one meaningful.`
            : "You’ve used today’s vouches. They refill over the next 24 hours."}
        </span>
      </div>

      <div className="field">
        <label htmlFor="url">YouTube link</label>
        <input id="url" name="url" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" aria-invalid={err?.field === "url"} aria-describedby={err?.field === "url" ? "form-error" : undefined} />
      </div>

      <div className="field">
        <label htmlFor="note">Why is it worth someone’s time? <span className="optional">Optional</span></label>
        <textarea id="note" name="note" className="note-input" maxLength={NOTE_MAX + 50} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Best explanation of GPU scheduling I’ve seen." aria-describedby="note-count" />
        <p id="note-count" className={`counter${note.length > NOTE_MAX ? " over" : ""}`} aria-live="polite">
          {note.length}/{NOTE_MAX}
        </p>
      </div>

      <fieldset className="field">
        <legend>Topics <span className="optional">Pick 1 to {MAX_TOPICS}</span></legend>
        {groups.map((g) => (
          <div key={g.name} className="topic-group">
            <p className="topic-group-name">{g.name}</p>
            <div className="chips">
              {g.topics.map((t) => {
                const on = picked.includes(t.slug);
                return (
                  <label key={t.slug} className="chip">
                    <input type="checkbox" name="topics" value={t.slug} checked={on} disabled={!on && picked.length >= MAX_TOPICS} onChange={() => toggle(t.slug)} />
                    <span>{t.name}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </fieldset>

      <label className="check">
        <input type="checkbox" name="own" checked={own} onChange={(e) => setOwn(e.target.checked)} />
        <span>
          I made this, or I&apos;m involved with this channel
          <small>Your vouch will be labelled as a creator vouch.</small>
        </span>
      </label>

      {err && <p id="form-error" className="error" role="alert">{err.message}</p>}

      <div className="actions">
        <button className="button large" disabled={pending || remaining === 0 || picked.length === 0 || note.length > NOTE_MAX}>
          {pending ? "Vouching…" : "Vouch"}
        </button>
        {picked.length === 0 && remaining > 0 && <span className="muted">Pick at least one topic to vouch.</span>}
      </div>
    </form>
  );
}
