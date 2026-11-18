import Link from "next/link";

const TABS = [
  { href: "/settings/profile", label: "Profile" },
  { href: "/settings/rules", label: "Rules" },
  { href: "/settings/account", label: "Account" },
] as const;

export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return (
    <>
      <nav className="settings-tabs" aria-label="Settings">
        {TABS.map((t) => <Link key={t.href} href={t.href}>{t.label}</Link>)}
      </nav>
      {children}
    </>
  );
}
