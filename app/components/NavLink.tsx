"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { socialEnabled } from "@/lib/flags";

const SOCIAL_NAV = [
  { href: "/", label: "Circle" },
  { href: "/discover", label: "Discover" },
  { href: "/search", label: "Search" },
  { href: "/lists", label: "Lists" },
  { href: "/people", label: "People" },
  { href: "/saved", label: "Saved" },
  { href: "/settings", label: "Settings" },
] as const;

/** Without the social layer, home is Discover and there is no one to follow yet. */
const PLAIN_NAV = [
  { href: "/", label: "Discover" },
  { href: "/search", label: "Search" },
  { href: "/lists", label: "Collections" },
  { href: "/saved", label: "Saved" },
] as const;

export const NAV = socialEnabled() ? SOCIAL_NAV : PLAIN_NAV;

/**
 * Marks the current section, so the header says where you are.
 * usePathname is request data, so the layout renders this inside Suspense with StaticNavLinks as the fallback.
 */
export function NavLinks() {
  const path = usePathname();
  return (
    <>
      {NAV.map(({ href, label }) => {
        const current = href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
        return (
          <Link key={href} href={href} className="nav-link" aria-current={current ? "page" : undefined}>
            {label}
          </Link>
        );
      })}
    </>
  );
}

export function StaticNavLinks() {
  return (
    <>
      {NAV.map(({ href, label }) => (
        <Link key={href} href={href} className="nav-link">{label}</Link>
      ))}
    </>
  );
}
