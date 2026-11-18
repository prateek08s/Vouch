import type { Metadata } from "next";
import { Newsreader, Schibsted_Grotesk } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/server/session";
import { initials } from "@/lib/format";
import { signOutAction } from "./actions";
import { NavLinks, StaticNavLinks } from "./components/NavLink";
import "./globals.css";

const sans = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const serif = Newsreader({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-serif", display: "swap" });

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
      <Link href="/vouch" className="button">Vouch for a video</Link>
      <Link href="/passport" className="who" title="Your Taste Passport">
        <span className="avatar sm" aria-hidden="true">{initials(user.display_name)}</span>
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
            <span>Every pick on Vouch has a person behind it.</span>
            <span>Videos play from YouTube.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
