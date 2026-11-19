"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { addToListAction, createListAction, type AddToListState, type ListFormState } from "@/app/lists/actions";

function submitWithoutReset(action: (d: FormData) => void) {
  return (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => action(data));
  };
}

export function CreateListForm() {
  const [state, action, pending] = useActionState<ListFormState, FormData>(createListAction, { status: "idle" });
  const [title, setTitle] = useState("");
  return (
    <form className="form" onSubmit={submitWithoutReset(action)} aria-label="Create a list">
      <div className="field">
        <label htmlFor="list-title">Title</label>
        <input id="list-title" name="title" type="text" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Learn Rust from zero" />
      </div>
      <div className="field">
        <label htmlFor="list-desc">What is it for? <span className="optional">Optional</span></label>
        <textarea id="list-desc" name="description" maxLength={500} placeholder="Six videos, in order, for someone who has never written Rust." />
      </div>
      <label className="check">
        <input type="checkbox" name="private" />
        <span>
          Keep it private
          <small>Only you can see private lists.</small>
        </span>
      </label>
      {state.status === "error" && <p className="error" role="alert" id="list-error">{state.message}</p>}
      <div className="actions">
        <button className="button" disabled={pending || !title.trim()}>{pending ? "Creating…" : "Create list"}</button>
      </div>
    </form>
  );
}

export function AddToList({ resourceId, lists }: { resourceId: string; lists: { id: string; title: string; has: boolean }[] }) {
  const [state, action, pending] = useActionState<AddToListState, FormData>(addToListAction, { status: "idle" });
  const [listId, setListId] = useState("");
  const available = lists.filter((l) => !l.has && !(state.status === "ok" && state.listId === l.id));

  if (!lists.length) {
    return <span className="tool"><Link href="/lists">Make a list</Link> to save videos like this one</span>;
  }
  return (
    <form className="rule-form" aria-label="Add to a list" onSubmit={submitWithoutReset(action)}>
      <input type="hidden" name="resourceId" value={resourceId} />
      <label htmlFor="add-list" className="skip-label">Add to list</label>
      <select id="add-list" name="listId" value={listId} onChange={(e) => setListId(e.target.value)} disabled={!available.length} style={{ minHeight: "2rem", padding: "0.25rem 0.5rem", flex: "0 1 14rem" }}>
        <option value="">{available.length ? "Add to a list…" : "In all your lists"}</option>
        {available.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
      </select>
      <button className="button ghost small" disabled={pending || !listId}>{pending ? "Adding…" : "Add"}</button>
      {state.status === "ok" && (
        <p className="success" role="status">
          Added to <Link href={`/lists/${state.listId}`}>{state.listTitle}</Link>.
        </p>
      )}
      {state.status === "error" && <p className="error" role="alert">{state.message}</p>}
    </form>
  );
}
