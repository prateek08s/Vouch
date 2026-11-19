"use client";
import { useEffect } from "react";
import { updateLocal, useLocal } from "./store";

/**
 * "Hide watched" for a server-rendered feed: marks the cards ([data-rid]) this browser has watched,
 * and hides them while the box is ticked. The choice is remembered in this browser.
 */
export function WatchedFilter({ ids }: { ids: string[] }) {
  const { watched, hideWatched } = useLocal();
  const count = ids.filter((id) => watched[id]).length;

  useEffect(() => {
    document.querySelectorAll<HTMLElement>("[data-rid]").forEach((el) => {
      const seen = Boolean(watched[el.dataset.rid!]);
      el.classList.toggle("is-watched", seen);
      el.hidden = hideWatched && seen;
      const badge = el.querySelector<HTMLElement>(".watched-badge");
      if (badge) badge.hidden = !seen;
    });
  }, [watched, hideWatched]);

  return (
    <label className="check hide-watched">
      <input type="checkbox" checked={hideWatched} onChange={(e) => updateLocal((s) => { s.hideWatched = e.target.checked; })} />
      Hide watched{count > 0 ? ` (${count} on this page)` : ""}
    </label>
  );
}
