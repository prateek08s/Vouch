import { headers } from "next/headers";

/** The caller's IP as reported by the hosting proxy (first x-forwarded-for hop, or x-real-ip). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (fwd || h.get("x-real-ip") || "unknown").slice(0, 64);
}
