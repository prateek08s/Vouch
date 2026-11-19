import type { Metadata } from "next";
import { SavedList } from "@/app/components/local/SavedList";

export const metadata: Metadata = { title: "Saved", robots: { index: false } };

export default function SavedPage() {
  return (
    <>
      <header className="page-head">
        <h1>Saved</h1>
        <p>Videos you saved for later on this device.</p>
      </header>
      <SavedList />
    </>
  );
}
