import type { ReactNode } from "react";

/** A short run of metadata (channel, runtime, topic), separated by thin rules. Empty values are dropped. */
export function Facts({ items, className }: { items: ReactNode[]; className?: string }) {
  const shown = items.filter((x) => x !== null && x !== undefined && x !== false && x !== "");
  if (!shown.length) return null;
  return (
    <p className={className ? `facts ${className}` : "facts"}>
      {shown.map((x, i) => <span key={i}>{x}</span>)}
    </p>
  );
}
