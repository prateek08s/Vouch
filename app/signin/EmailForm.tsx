"use client";
import { useActionState } from "react";
import { emailSignInAction, type EmailState } from "@/app/auth/actions";

export function EmailForm({ primary }: { primary: boolean }) {
  const [state, action, pending] = useActionState<EmailState, FormData>(emailSignInAction, { status: "idle" });
  if (state.status === "sent") {
    return (
      <p className="done" role="status">
        Check {state.email} for a sign-in link. It works once, in this browser.
      </p>
    );
  }
  return (
    <form action={action} className="email-signin">
      <label htmlFor="email">Email</label>
      <div className="email-row">
        <input id="email" name="email" type="email" required autoComplete="email" placeholder="you@example.com"
          aria-invalid={state.status === "error"} aria-describedby={state.status === "error" ? "email-error" : undefined} />
        <button className={primary ? "button" : "button ghost"} disabled={pending}>
          {pending ? "Sending…" : "Email me a link"}
        </button>
      </div>
      {state.status === "error" && <p id="email-error" className="error" role="alert">{state.message}</p>}
    </form>
  );
}
