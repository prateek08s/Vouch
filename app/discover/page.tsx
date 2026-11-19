import { Suspense } from "react";
import { DiscoverFeed } from "@/app/components/DiscoverFeed";

export const metadata = { title: "Discover worthwhile videos", description: "Long videos Hacker News commenters recommended, each with the comment that recommended it." };

export default function Discover({ searchParams }: PageProps<"/discover">) {
  return (
    <>
      <header className="page-head">
        <h1>Discover</h1>
        <p>Long videos Hacker News commenters recommended, ranked by how many people recommend them and how often they were worth it.</p>
      </header>
      <Suspense fallback={<p className="muted">Loading recommendations…</p>}>
        <DiscoverFeed searchParams={searchParams} base="/discover" />
      </Suspense>
    </>
  );
}
