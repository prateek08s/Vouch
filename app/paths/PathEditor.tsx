"use client";
import { startTransition, useActionState } from "react";
import { PATH_LEVELS, type PathMetadata } from "@/lib/paths";
import { savePathAction, type PathFormState } from "./actions";

export function PathEditor({ listId, metadata }: { listId: string; metadata: PathMetadata | null }) {
  const [state, action, pending] = useActionState<PathFormState, FormData>(savePathAction, { status: "idle" });
  return (
    <details className="path-editor">
      <summary>{metadata ? "Edit learning path" : "Make this a learning path"}</summary>
      <p className="section-note">Use a deliberate lesson order. Describe what people should know first and what they will learn.</p>
      <form className="form" onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => action(data));
      }}>
        <input type="hidden" name="listId" value={listId} />
        <label className="check"><input type="checkbox" name="enabled" defaultChecked />Treat this collection as a learning path</label>
        <div className="field">
          <label htmlFor="path-level">Level</label>
          <select id="path-level" name="level" defaultValue={metadata?.level ?? "beginner"}>
            {Object.entries(PATH_LEVELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="path-prerequisites">Before you start</label>
          <textarea id="path-prerequisites" name="prerequisites" defaultValue={metadata?.prerequisites.join("\n") ?? ""} maxLength={2000} rows={3} aria-describedby="prerequisite-help" />
          <small id="prerequisite-help">Optional. One prerequisite per line, up to 8 lines and 240 characters per line.</small>
        </div>
        <div className="field">
          <label htmlFor="path-outcomes">What you will learn</label>
          <textarea id="path-outcomes" name="outcomes" defaultValue={metadata?.outcomes.join("\n") ?? ""} maxLength={2000} rows={4} aria-describedby="outcome-help" />
          <small id="outcome-help">Add 1 to 8 outcomes, one per line, up to 240 characters per line.</small>
        </div>
        <p className="section-note">Public collections appear in Learning paths once they have an available lesson. Private paths stay private. Turning this off keeps your collection and videos.</p>
        <button className="button small" disabled={pending}>{pending ? "Saving…" : "Save path settings"}</button>
        {state.message && <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? "error" : "success"}>{state.message}</p>}
      </form>
    </details>
  );
}
