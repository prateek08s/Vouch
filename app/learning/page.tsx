import Link from "next/link";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/server/session";
import { getDb } from "@/lib/server/db";
import { learningLibrary } from "@/lib/learning";
import { Library, type LibraryView } from "./Library";

export const metadata = { title: "My learning", description: "Continue watching and return to the videos you saved." };
const VIEWS: { id: LibraryView; label: string }[] = [
  { id: "continue", label: "Continue watching" },
  { id: "saved", label: "Saved for later" },
  { id: "history", label: "History" },
];

export default function LearningPage(props: PageProps<"/learning">) {
  return (
    <>
      <header className="page-head">
        <h1>My learning</h1>
        <p>Pick up where you left off.</p>
      </header>
      <Suspense fallback={<p className="muted">Loading your videos…</p>}>
        <Learning {...props} />
      </Suspense>
    </>
  );
}

async function Learning({ searchParams }: PageProps<"/learning">) {
  const params = await searchParams;
  const requested = Array.isArray(params.view) ? params.view[0] : params.view;
  const view = VIEWS.find((item) => item.id === requested)?.id ?? "continue";
  const user = await getCurrentUser();
  const entries = user ? await learningLibrary(await getDb(), user.id) : [];
  return (
    <>
      <nav className="learning-tabs" aria-label="Your learning">
        {VIEWS.map((item) => <Link key={item.id} href={`/learning?view=${item.id}`} aria-current={view === item.id ? "page" : undefined}>{item.label}</Link>)}
      </nav>
      <Library entries={entries} signedIn={!!user} view={view} />
    </>
  );
}
