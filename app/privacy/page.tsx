import type { Metadata } from "next";
import Link from "next/link";
import { Contact } from "@/app/components/Contact";

export const metadata: Metadata = { title: "Privacy", description: "What Vouch stores about you, who can see it, and how to delete it." };

export default function PrivacyPage() {
  return (
    <article className="prose">
      <header className="page-head">
        <h1>Privacy</h1>
        <p>What Vouch stores, who can see it, and how to take it back. Last updated 19 November 2026.</p>
      </header>

      <h2>What we store</h2>
      <ul>
        <li><strong>Your profile:</strong> the name, username and picture your sign-in provider (GitHub) shares, and anything you add, such as a bio.</li>
        <li><strong>Your vouches:</strong> the videos you vouch for, your notes and topics. These are public and appear with your name.</li>
        <li><strong>Your Worth-it ratings:</strong> private. Other people never see your individual ratings. They contribute to totals, such as how often a curator&apos;s picks are rated Worth it, which are shown only once enough people have rated.</li>
        <li><strong>Follows, lists, topics and rules:</strong> follows and public lists are visible to others; private lists and your rules are not.</li>
        <li><strong>What you were shown and opened:</strong> so we can tell which recommendations work. Reported only as totals across everyone.</li>
      </ul>
      <p>We don&apos;t sell data, show ads, or use third-party trackers.</p>

      <h2>Services we rely on</h2>
      <ul>
        <li><strong>Supabase</strong> hosts the database and handles sign-in.</li>
        <li><strong>YouTube</strong> plays videos through its privacy-enhanced embed (youtube-nocookie.com). When you press play, YouTube&apos;s own terms and privacy policy apply.</li>
        <li><strong>GitHub</strong> confirms who you are when you sign in. We receive your public profile and email address; we don&apos;t post anything to GitHub.</li>
      </ul>

      <h2>Your choices</h2>
      <ul>
        <li>Edit your profile any time in <Link href="/settings/profile">Settings</Link>.</li>
        <li>Download everything you&apos;ve put into Vouch, or delete your account, in <Link href="/settings/account">Account settings</Link>. Deleting removes your profile, vouches, ratings, follows, lists and rules.</li>
        <li>Your Taste Passport is private unless you choose to share it.</li>
      </ul>

      <h2>Questions</h2>
      <p>Contact us <Contact />.</p>
    </article>
  );
}
