"use client";
import Image from "next/image";
import Link from "next/link";
import { exportLocal, updateLocal, useLocal } from "./store";

export function SavedList() {
  const { saved, watched } = useLocal();
  const items = Object.entries(saved).sort((a, b) => b[1].at - a[1].at);
  const download = () => {
    const url = URL.createObjectURL(new Blob([exportLocal()], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "vouch-saved.json" });
    a.click();
    URL.revokeObjectURL(url);
  };
  if (!items.length) {
    return (
      <div className="empty">
        <strong>Nothing saved yet.</strong>
        <p>Open a video and press Save for later. It stays in this browser, no account needed.</p>
        <div className="actions"><Link className="button" href="/">Browse picks</Link></div>
      </div>
    );
  }
  return (
    <>
      <ul className="saved-list">
        {items.map(([id, it]) => (
          <li key={id} className={watched[id] ? "is-watched" : undefined}>
            <Link className="frame" href={`/watch/${id}`} tabIndex={-1} aria-hidden="true">
              {it.thumb ? <Image unoptimized src={it.thumb} alt="" fill sizes="10rem" /> : <span className="placeholder">Vouch</span>}
            </Link>
            <div>
              <Link href={`/watch/${id}`} className="saved-title">{it.title}</Link>
              {watched[id] && <span className="watched-badge">Watched</span>}
            </div>
            <button type="button" className="link-button" onClick={() => updateLocal((s) => { delete s.saved[id]; })}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <p className="muted">
        Saved in this browser only. <button type="button" className="link-button" onClick={download}>Download a copy</button>
      </p>
    </>
  );
}
