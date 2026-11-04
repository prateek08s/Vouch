import { ImageResponse } from "next/og";
import { connection } from "next/server";
import { getDb } from "@/lib/server/db";
import { LEVEL_LABEL, publicPassport } from "@/lib/passport";

export const alt = "A Vouch Taste Passport";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#f0efdf";
const MUTED = "#a4a79a";
const ACCENT = "#d5ed91";
const PAPER = "#10110f";

/** The share card (plan 7.5). Private Passports get a generic card, so nothing leaks through the image. */
export default async function Image({ params }: { params: Promise<{ username: string }> }) {
  await connection();
  const { username } = await params;
  const p = await publicPassport(await getDb(), decodeURIComponent(username));
  const topics = p?.topics ?? [];
  const rate = p?.success?.worthItRate;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: PAPER, color: INK, padding: 72, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", fontSize: 28, color: ACCENT, letterSpacing: 4 }}>TASTE PASSPORT</div>
        <div style={{ display: "flex", fontSize: 72, fontWeight: 700, marginTop: 16 }}>{p ? p.user.displayName : "Vouch"}</div>
        {p ? (
          <div style={{ display: "flex", flexDirection: "column", marginTop: 40, gap: 14 }}>
            {topics.slice(0, 4).map((t) => (
              <div key={t.topicId} style={{ display: "flex", alignItems: "baseline", gap: 24, fontSize: 40 }}>
                <span style={{ fontWeight: 700 }}>{t.name}</span>
                <span style={{ fontSize: 28, color: MUTED }}>{LEVEL_LABEL[t.level]}</span>
              </div>
            ))}
            {!topics.length && <div style={{ display: "flex", fontSize: 32, color: MUTED }}>Just getting started.</div>}
          </div>
        ) : (
          <div style={{ display: "flex", fontSize: 36, color: MUTED, marginTop: 40 }}>Videos worth your time, from people whose taste you trust.</div>
        )}
        <div style={{ display: "flex", marginTop: "auto", justifyContent: "space-between", fontSize: 28, color: MUTED }}>
          <span>{rate != null ? `${Math.round(rate * 100)}% of their picks rated Worth it` : ""}</span>
          <span style={{ color: ACCENT }}>vouch</span>
        </div>
      </div>
    ),
    size,
  );
}
