import type { Metadata } from "next";
import { Contact } from "@/app/components/Contact";

export const metadata: Metadata = { title: "Terms", description: "The rules for using Vouch." };

export default function TermsPage() {
  return (
    <article className="prose">
      <header className="page-head">
        <h1>Terms</h1>
        <p>The ground rules for using Vouch. Last updated 19 November 2026.</p>
      </header>

      <h2>Vouching</h2>
      <ul>
        <li>A vouch says a video is worth someone&apos;s time. Vouch only for videos you genuinely recommend.</li>
        <li>If you made the video or work with its channel, mark it as a creator vouch.</li>
        <li>Notes must not harass anyone, share private information, or break the law. We may hide vouches or suspend accounts that do.</li>
        <li>You keep the rights to your notes, and let Vouch show them alongside the video.</li>
      </ul>

      <h2>Videos and quotes</h2>
      <ul>
        <li>Videos belong to their creators and play from YouTube under YouTube&apos;s terms. Vouch doesn&apos;t host video.</li>
        <li>
          Hacker News picks quote public comments in their authors&apos; own words, with a link to each comment, from the{" "}
          <a href="https://huggingface.co/datasets/open-index/hacker-news">open-index/hacker-news</a> dataset (ODC-BY). Vouch is not affiliated with Hacker News or Y Combinator.
        </li>
      </ul>

      <h2>The service</h2>
      <ul>
        <li>Vouch is provided as is, while it is being built. Features may change or be removed.</li>
        <li>You can stop using Vouch and delete your account at any time.</li>
      </ul>

      <p>Questions: <Contact />.</p>
    </article>
  );
}
