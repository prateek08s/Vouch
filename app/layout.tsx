import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/server/session";
import { signOutAction } from "@/app/auth/actions";
import { NavLinks, StaticNavLinks } from "./components/NavLink";
import { Avatar } from "./components/Avatar";
import "./globals.css";

// Self-hosted (SIL Open Font License, app/fonts/OFL-*.txt): no request to Google Fonts at build or run time.
const sans = localFont({
  src: "./fonts/schibsted-grotesk-latin-wght-normal.woff2",
  weight: "400 900",
  variable: "--font-sans",
  display: "swap",
});
const serif = localFont({
  src: [
    { path: "./fonts/newsreader-latin-opsz-normal.woff2", weight: "200 800", style: "normal" },
    { path: "./fonts/newsreader-latin-opsz-italic.woff2", weight: "200 800", style: "italic" },
  ],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Vouch", template: "%s | Vouch" },
  description: "Discover what's worth watching through people whose taste you trust.",
};

async function UserNav() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <div className="nav-user">
        <Link href="/signin" className="button">Sign in</Link>
      </div>
    );
  }
  return (
    <div className="nav-user">
      {user.is_admin && <Link href="/admin" className="button quiet small">Reports</Link>}
      <Link href="/vouch" className="button">Vouch for a video</Link>
      <Link href="/passport" className="who" title="Your Taste Passport">
        <Avatar name={user.display_name} src={user.avatar_url} size="sm" />
        <span className="who-name">{user.display_name}</span>
      </Link>
      <form action={signOutAction}>
        <button className="button quiet small signout">Sign out</button>
      </form>
    </div>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <header className="site-header">
          <div className="shell">
            <Link href="/" className="wordmark" aria-label="Vouch, your Circle">
              <span className="mark" aria-hidden="true">“</span>Vouch
            </Link>
            <nav className="nav" aria-label="Main">
              <div className="nav-links">
                <Suspense fallback={<StaticNavLinks />}>
                  <NavLinks />
                </Suspense>
              </div>
              <Suspense fallback={<div className="nav-user" />}>
                <UserNav />
              </Suspense>
            </nav>
          </div>
        </header>
        <main id="main" className="shell">{children}</main>
        <footer className="site-footer">
          <div className="shell">
            <span>Every pick on Vouch has a person behind it. Videos play from YouTube.</span>
            <span className="footer-links">
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
              <a href="https://huggingface.co/datasets/open-index/hacker-news">HN data: open-index (ODC-BY)</a>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
