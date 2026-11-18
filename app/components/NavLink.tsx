"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const NAV = [
  { href: "/", label: "Circle" },
  { href: "/discover", label: "Discover" },
  { href: "/search", label: "Search" },
  { href: "/lists", label: "Lists" },
  { href: "/people", label: "People" },
  { href: "/settings", label: "Settings" },
] as const;

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
