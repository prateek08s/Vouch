import type { Metadata } from "next";
import { Suspense } from "react";
import { authConfigured, authProviders } from "@/lib/auth/config";
import { oauthSignIn } from "@/app/auth/actions";

export const metadata: Metadata = { title: "Sign in" };

const PROVIDER_LABEL = { github: "GitHub", google: "Google" } as const;

export default function SignInPage({ searchParams }: PageProps<"/signin">) {
  if (!authConfigured()) {
    return (
      <div className="signin">
        <header>
          <h1>Sign-in isn’t available yet</h1>
          <p className="intro">Vouch is being set up. You can still browse public picks.</p>
        </header>
        {process.env.NODE_ENV !== "production" && (
          <div className="panel stack">
            <strong>Connect Supabase Auth to turn on sign-in</strong>
            <p className="muted">
              Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> to{" "}
              <code>.env.local</code>, enable GitHub in Supabase, then restart the dev server. The README has
              the full steps. Only you see this note; it is hidden in production.
            </p>
          </div>
        )}
        <div className="actions"><a className="button ghost" href="/discover">Browse public picks</a></div>
      </div>
    );
  }
  return (
    <div className="signin">
      <header>
        <h1>Sign in to Vouch</h1>
        <p className="intro">Follow people whose taste you trust, save what you find, and build your Circle.</p>
      </header>
      <form action={oauthSignIn} className="provider">
        {authProviders().map((p, i) => (
          <button key={p} className={i === 0 ? "button" : "button ghost"} name="provider" value={p}>
            Continue with {PROVIDER_LABEL[p]}
          </button>
        ))}
      </form>
      <Suspense fallback={null}><SignInError searchParams={searchParams} /></Suspense>
      <p className="muted">
        New here? Signing in creates your account. Setup takes about a minute: pick a few topics and people to follow.
      </p>
    </div>
  );
}

async function SignInError({ searchParams }: { searchParams: PageProps<"/signin">["searchParams"] }) {
  const { error } = await searchParams;
  if (!error) return null;
  const message =
    error === "configuration"
      ? "Sign-in isn’t configured on this server."
      : "Sign-in didn’t finish. Try again, or use the other provider.";
  return <p className="error" role="alert">{message}</p>;
}
