import Image from "next/image";
import { initials } from "@/lib/format";

/** A person's picture when they have one (from GitHub), otherwise their initials. */
export function Avatar({ name, src, size }: { name: string; src?: string | null; size?: "sm" | "lg" }) {
  const cls = size ? `avatar ${size}` : "avatar";
  const px = size === "lg" ? 56 : size === "sm" ? 28 : 36;
  if (src) return <Image className={`${cls} avatar-img`} src={src} alt="" width={px} height={px} unoptimized />;
  return <span className={cls} aria-hidden="true">{initials(name)}</span>;
}
