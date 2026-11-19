import { cookies } from "next/headers";
import { ANON_COOKIE, experimentOn, isAnonId, variantFor, type Variant } from ".";

/**
 * This browser's anonymous ID and the variant it sees, or null without the cookie.
 * Outside the experiment everyone sees the note, and events are recorded as "note".
 */
export async function anonContext(): Promise<{ anonId: string; variant: Variant } | null> {
  const id = (await cookies()).get(ANON_COOKIE)?.value;
  if (!isAnonId(id)) return null;
  return { anonId: id, variant: experimentOn() ? variantFor(id) : "note" };
}
