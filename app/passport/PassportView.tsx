import { LEVEL_LABEL, MIN_RATINGS_FOR_RATE, type Passport } from "@/lib/passport";

/** Shared by the owner's Passport and the public one. Levels, not fake-precise scores (plan 7.2). */
export function PassportView({ p }: { p: Passport }) {
  const s = p.success;
  return (
    <div className="passport">
      <section aria-labelledby="pp-topics">
        <h2 id="pp-topics" className="eyebrow">Taste</h2>
        {p.topics ? (
          <ul className="passport-topics">
            {p.topics.map((t) => (
              <li key={t.topicId} className={`level-${t.level}`}>
                <strong>{t.name}</strong>
                <span>{LEVEL_LABEL[t.level]}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="trust-tag">
            {p.view === "owner"
              ? "Too early to tell. Vouch for a few videos or rate some Worth it, and your taste will show here."
              : "Not enough vouches yet to describe a taste."}
          </p>
        )}
      </section>

      {s && (
        <section aria-labelledby="pp-success">
          <h2 id="pp-success" className="eyebrow">As a curator</h2>
          <dl className="passport-stats">
            <div>
              <dt>Picks rated Worth it</dt>
              <dd>{s.worthItRate === null ? "Not enough ratings yet" : `${Math.round(s.worthItRate * 100)}%`}</dd>
              {s.worthItRate === null && <small>Shown after {MIN_RATINGS_FOR_RATE} ratings ({s.rated} so far)</small>}
            </div>
            <div>
              <dt>People who found something worth watching through {p.view === "owner" ? "you" : p.user.displayName.split(" ")[0]}</dt>
              <dd>{s.peopleHelped}</dd>
            </div>
            {s.trustedFor.length > 0 && (
              <div>
                <dt>Most trusted for</dt>
                <dd>{s.trustedFor.join(" · ")}</dd>
              </div>
            )}
          </dl>
        </section>
      )}
      <p className="trust-tag">{p.vouchCount} {p.vouchCount === 1 ? "vouch" : "vouches"}</p>
    </div>
  );
}
