"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { addToListAction, createListAction, type AddToListState, type ListFormState } from "@/app/actions";

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
        <input id="list-title" name="title" type="text" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Learn Rust from Zero" />
      </div>
      <div className="field">
        <label htmlFor="list-desc">What is it for? <span className="trust-tag">(optional)</span></label>
        <textarea id="list-desc" name="description" maxLength={500} placeholder="Six videos, in order, for someone who has never written Rust." />
      </div>
      <label className="check">
        <input type="checkbox" name="private" />
        <span>Keep it private <span className="trust-tag">Only you can see private lists.</span></span>
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
    return <p className="trust-tag"><Link href="/lists">Make a list</Link> to collect videos like this one.</p>;
  }
  return (
    <form className="rule-form" aria-label="Add to a list" onSubmit={submitWithoutReset(action)}>
      <input type="hidden" name="resourceId" value={resourceId} />
      <label htmlFor="add-list" className="trust-tag">Add to list</label>
      <select id="add-list" name="listId" value={listId} onChange={(e) => setListId(e.target.value)} disabled={!available.length}>
        <option value="">{available.length ? "Choose a list…" : "Already in all your lists"}</option>
        {available.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
      </select>
      <button className="button ghost" disabled={pending || !listId}>{pending ? "Adding…" : "Add"}</button>
      {state.status === "ok" && (
        <p className="success" role="status" style={{ flexBasis: "100%" }}>
          Added to <Link href={`/lists/${state.listId}`}>{state.listTitle}</Link>.
        </p>
      )}
      {state.status === "error" && <p className="error" role="alert">{state.message}</p>}
    </form>
  );
}
