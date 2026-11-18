"use client";

import { startTransition, useActionState, useState } from "react";
import { updateProfileAction, type ProfileState } from "../actions";

type Initial = { username: string; displayName: string; bio: string };

export function ProfileForm({ initial }: { initial: Initial }) {
  const [state, action, pending] = useActionState<ProfileState, FormData>(updateProfileAction, { status: "idle" });
  const [v, setV] = useState(initial);
  const set = (k: keyof Initial) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <form
      className="form panel"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <div className="field">
        <label htmlFor="displayName">Name</label>
        <input id="displayName" name="displayName" type="text" maxLength={60} required value={v.displayName} onChange={set("displayName")} />
      </div>
      <div className="field">
        <label htmlFor="username">Username</label>
        <input id="username" name="username" type="text" maxLength={24} required value={v.username} onChange={set("username")} aria-describedby="username-hint" />
        <p id="username-hint" className="hint">Your public page is vouch.app/u/{v.username || "…"}. Lowercase letters, numbers and underscores.</p>
      </div>
      <div className="field">
        <label htmlFor="bio">Bio <span className="optional">Optional</span></label>
        <textarea id="bio" name="bio" maxLength={280} value={v.bio} onChange={set("bio")} placeholder="What kind of videos you vouch for." />
        <p className={`counter${v.bio.length > 280 ? " over" : ""}`}>{v.bio.length}/280</p>
      </div>
      {state.status === "error" && <p className="error" role="alert">{state.message}</p>}
      {state.status === "ok" && <p className="success" role="status">Profile saved.</p>}
      <div className="actions">
        <button className="button" disabled={pending}>{pending ? "Saving…" : "Save profile"}</button>
      </div>
    </form>
  );
}
