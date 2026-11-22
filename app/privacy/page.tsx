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

      <h2>Without an account</h2>
      <ul>
        <li><strong>Saved videos, playback position, watched or skipped choices, and your Worth-it answers</strong> are kept in this browser only (local storage). Clearing your browser data removes them, and you can download a copy from <Link href="/saved">Saved</Link>.</li>
        <li><strong>A random browser ID</strong> in a first-party cookie (<code>vouch_aid</code>). With it we count, per browser, which picks were shown, which were opened, and Worth-it answers, so we can tell whether the picks are any good. It is never linked to your name, your account or other sites, and these records are deleted after 90 days.</li>
        <li>Some browsers see picks without the Hacker News comment, so we can measure whether the comment helps. Every video page still shows it.</li>
      </ul>

      <h2>With an account</h2>
      <ul>
        <li><strong>Your profile:</strong> the name, username and picture your sign-in provider (GitHub) shares, or just your email address if you sign in by email link, and anything you add, such as a bio.</li>
        <li><strong>Saved videos and playback progress:</strong> when signed in, Vouch stores your saved videos, playback position and watched or skipped choices privately with your account. Playback updates are sent about every ten seconds while playing and when you pause. They are included in account exports and removed when you delete your account. Browser history from before sign-in stays on that device.</li>
        <li><strong>Your vouches:</strong> the videos you vouch for, your notes and topics. These are public and appear with your name.</li>
        <li><strong>Your Worth-it ratings:</strong> private. Other people never see your individual ratings. They contribute to totals, such as how often a curator&apos;s picks are rated Worth it, which are shown only once enough people have rated.</li>
        <li><strong>Follows, lists, topics and rules:</strong> follows and public lists are visible to others; private lists and your rules are not.</li>
        <li><strong>What you were shown and opened:</strong> linked to your account, so we can tell which recommendations work. Reported only as totals across everyone, and deleted with your account.</li>
      </ul>
      <p>We don&apos;t sell data, show ads, or use third-party trackers.</p>

      <h2>Services we rely on</h2>
      <ul>
        <li><strong>Supabase</strong> hosts the database and handles sign-in.</li>
        <li><strong>YouTube</strong> plays videos through its privacy-enhanced embed (youtube-nocookie.com). When you press play, YouTube&apos;s own terms and privacy policy apply.</li>
        <li><strong>GitHub</strong> confirms who you are when you sign in with it. We receive your public profile and email address; we don&apos;t post anything to GitHub.</li>
        <li><strong>Hacker News</strong> is where the recommendations come from. We quote short excerpts of public comments and link to them.</li>
      </ul>

      <h2>Your choices</h2>
      <ul>
        <li>Edit your profile any time in <Link href="/settings/profile">Settings</Link>.</li>
        <li>Download everything you&apos;ve put into Vouch, or delete your account, in <Link href="/settings/account">Account settings</Link>. Deleting removes your profile, vouches, ratings, follows, lists and rules.</li>
        <li>Block the browser ID by blocking cookies for this site; everything still works.</li>
      </ul>

      <h2>Questions</h2>
      <p>Contact us <Contact />.</p>
    </article>
  );
}
