"use client";

import { startTransition, useActionState, useState, type ReactNode } from "react";
import { addRuleAction, type RuleState } from "@/app/settings/rules/actions";

/**
 * One small form per rule kind. The value is kept on error (no automatic form reset)
 * and cleared on success.
 */
export function RuleForm({
  kind,
  label,
  children,
  submitLabel = "Add rule",
}: {
  kind: string;
  label: string;
  children?: (value: string, setValue: (v: string) => void) => ReactNode;
  submitLabel?: string;
}) {
  const [state, action, pending] = useActionState<RuleState, FormData>(addRuleAction, { status: "idle" });
  const [value, setValue] = useState("");
  const [seenOk, setSeenOk] = useState<RuleState | null>(null);
  if (state.status === "ok" && state !== seenOk) {
    setSeenOk(state);
    setValue("");
  }
  const errorId = `${kind}-error`;

  return (
    <form
      className="rule-form"
      aria-label={label}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <input type="hidden" name="kind" value={kind} />
      {children ? children(value, setValue) : <input type="hidden" name="value" value="" />}
      <button className="button ghost" disabled={pending || (!!children && !value.trim())}>
        {pending ? "Saving…" : submitLabel}
      </button>
      {state.status === "error" && (
        <p id={errorId} className="error" role="alert">{state.message}</p>
      )}
    </form>
  );
}
