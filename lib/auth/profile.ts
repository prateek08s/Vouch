import { randomUUID } from "node:crypto";
import type { Db } from "@/lib/db";
import type { User } from "@/lib/users";
import { usernameFrom } from "@/lib/users";

/** Identity is linked by provider id, never by an unverified display name or email. */
export async function ensureProfile(db: Db, identity: { id: string; user_metadata?: Record<string, unknown> }): Promise<User> {
  return db.transaction(async tx => {
    await tx.query("select pg_advisory_xact_lock(hashtext($1))", [identity.id]);
    const [existing] = await tx.query<User>("select * from users where auth_user_id = $1", [identity.id]);
    if (existing) return existing;
    const raw = identity.user_metadata?.full_name ?? identity.user_metadata?.name;
    const name = (typeof raw === "string" ? raw.trim() : "").slice(0, 60) || "New member";
    for (let attempt = 0; attempt < 5; attempt++) {
      const username = usernameFrom(name, randomUUID().replaceAll("-", "").slice(0, 10));
      const [user] = await tx.query<User>(
        "insert into users (auth_user_id, username, display_name) values ($1, $2, $3) on conflict (username) do nothing returning *",
        [identity.id, username, name],
      );
      if (!user) continue;
      await tx.query("insert into events (user_id, name) values ($1, 'signup')", [user.id]);
      return user;
    }
    throw new Error("Unable to create a unique profile.");
  });
}
