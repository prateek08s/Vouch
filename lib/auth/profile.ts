import { randomUUID } from "node:crypto";
import type { Db } from "@/lib/db";
import type { User } from "@/lib/users";
import { USERNAME_PATTERN, usernameFrom } from "@/lib/users";

type Identity = { id: string; user_metadata?: Record<string, unknown> };

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** What a provider tells us about the person. GitHub: full_name/name, user_name, avatar_url. */
export function profileHints(identity: Identity) {
  const m = identity.user_metadata ?? {};
  const handle = text(m.user_name ?? m.preferred_username).toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 24);
  const name = (text(m.full_name) || text(m.name) || text(m.user_name)).slice(0, 60);
  const avatar = text(m.avatar_url ?? m.picture);
  return {
    displayName: name || "New member",
    /** The provider handle, when it is a valid Vouch username. */
    handle: USERNAME_PATTERN.test(handle) ? handle : null,
    avatarUrl: avatar.startsWith("https://") ? avatar : null,
  };
}

/** Identity is linked by provider id, never by an unverified display name or email. */
export async function ensureProfile(db: Db, identity: Identity): Promise<User> {
  return db.transaction(async tx => {
    await tx.query("select pg_advisory_xact_lock(hashtext($1))", [identity.id]);
    const [existing] = await tx.query<User>("select * from users where auth_user_id = $1", [identity.id]);
    const hints = profileHints(identity);
    if (existing) {
      // Fill an avatar the person hasn't set; never overwrite one they chose.
      if (!existing.avatar_url && hints.avatarUrl) {
        const [u] = await tx.query<User>("update users set avatar_url = $2 where id = $1 returning *", [existing.id, hints.avatarUrl]);
        return u;
      }
      return existing;
    }
    // Prefer the provider handle as is ("prateek08s"), then the handle or name with a short suffix.
    const candidates = [
      hints.handle,
      ...Array.from({ length: 5 }, () =>
        usernameFrom(hints.handle ?? hints.displayName, randomUUID().replaceAll("-", "").slice(0, 4))),
    ].filter((u): u is string => Boolean(u));
    for (const username of candidates) {
      const [user] = await tx.query<User>(
        `insert into users (auth_user_id, username, display_name, avatar_url) values ($1, $2, $3, $4)
         on conflict (username) do nothing returning *`,
        [identity.id, username, hints.displayName, hints.avatarUrl],
      );
      if (!user) continue;
      await tx.query("insert into events (user_id, name) values ($1, 'signup')", [user.id]);
      return user;
    }
    throw new Error("Unable to create a unique profile.");
  });
}
