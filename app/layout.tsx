import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/server/session";
import { signOutAction } from "./actions";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Vouch", template: "%s | Vouch" },
  description: "Discover what's worth watching through people whose taste you trust.",
};

async function UserNav() {
  const user = await getCurrentUser();
  if (!user) return <Link href="/signin">Sign in</Link>;
  return (
    <>
      <Link href="/settings/rules">Rules</Link>
      <Link href="/vouch" className="vouch-cta">Vouch</Link>
      <span className="who">{user.display_name}</span>
      <form action={signOutAction}>
        <button className="button ghost" style={{ color: "var(--forest-ink)", borderColor: "var(--rule)", padding: "0.2rem 0.7rem" }}>
          Sign out
        </button>
      </form>
    </>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <header className="site-header">
          <div className="shell">
            <Link href="/" className="wordmark">
              <span className="mark" aria-hidden="true">“</span> Vouch
            </Link>
            <nav className="nav" aria-label="Main">
              <Link href="/">Circle</Link>
              <Link href="/discover">Discover</Link>
              <Link href="/search">Search</Link>
              <Link href="/lists">Lists</Link>
              <Link href="/people">People</Link>
              <Suspense fallback={null}>
                <UserNav />
              </Suspense>
            </nav>
          </div>
        </header>
        <main id="main" className="shell">{children}</main>
      </body>
    </html>
  );
}
