"use client";
import { startTransition, useActionState } from "react";
import { LESSON_RESOURCE_MAX, RESOURCE_KINDS, type LessonResource } from "@/lib/lesson-resources/model";
import { lessonResourceAction, type ResourceFormState } from "./resources-actions";
export function ResourceEditor({ listId, resourceId, resources }: { listId: string; resourceId: string; resources: LessonResource[] }) {
  const [state, action, pending] = useActionState<ResourceFormState, FormData>(lessonResourceAction, { status: "idle" });
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  };
  const fields = <><input type="hidden" name="listId" value={listId} /><input type="hidden" name="resourceId" value={resourceId} /></>;
  return <details className="resource-editor">
    <summary>Manage lesson resources</summary>
    {resources.map((item) => <form key={item.id} className="resource-remove" onSubmit={submit}>
      {fields}<input type="hidden" name="op" value="remove" /><input type="hidden" name="attachmentId" value={item.id} />
      <span>{item.title}</span><button className="button quiet small" disabled={pending} aria-label={`Remove resource ${item.title}`}>Remove</button>
    </form>)}
    {resources.length < LESSON_RESOURCE_MAX && <form className="form" onSubmit={submit} aria-label="Add lesson resource">
      {fields}<input type="hidden" name="op" value="add" />
      <label>Resource type<select name="kind" defaultValue="code">{Object.entries(RESOURCE_KINDS).map(([kind, title]) => <option key={kind} value={kind}>{title}</option>)}</select></label>
      <label>Title<input name="title" required maxLength={120} placeholder="Example code for this lesson" /></label>
      <label>Link<input name="url" type="url" required maxLength={2048} placeholder="https://…" /></label>
      <p className="muted">Up to 8 links per lesson. Resources follow this collection’s privacy settings.</p>
      <button className="button small" disabled={pending}>{pending ? "Saving…" : "Add resource"}</button>
    </form>}
    {state.message && <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? "error" : "success"}>{state.message}</p>}
  </details>;
}
