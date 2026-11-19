/**
 * The social layer (Circle, people, follows, trust labels, Taste Passport, onboarding, list follows,
 * most personal rules, public vouching) waits for real curators. Off by default; set
 * NEXT_PUBLIC_VOUCH_SOCIAL=1 at build time to turn it back on. The code stays; only the screens hide.
 * The variable is read by its literal name so Next.js can inline it in browser code too.
 */
export function socialEnabled(env?: Record<string, string | undefined>): boolean {
  return (env ? env.NEXT_PUBLIC_VOUCH_SOCIAL : process.env.NEXT_PUBLIC_VOUCH_SOCIAL) === "1";
}
