# Vouch

The human recommendation layer for video. Plan: `../Vouch_Detailed_Plan.md`.

## Run it

```bash
npm install
npm run dev            # http://localhost:3000, sign in as "Alex" to see a seeded Circle
```

The first request creates a local Postgres (PGlite) in `.data/pglite` and seeds demo curators
with real YouTube videos. Delete `.data/` to start fresh. Set `YOUTUBE_API_KEY` to get durations
(without it, metadata comes from oEmbed and has no runtime).

## Test it

```bash
npm test               # 314 tests: unit + database integration (real Postgres via PGlite)
npm run typecheck
npm run lint
node --experimental-transform-types scripts/smoke-oembed.mts   # live YouTube check
```

## What is built (plan weeks 3 to 6 and 8)

| Area | Code | Plan |
|---|---|---|
| Schema + migrations | `supabase/migrations/` | 19 |
| YouTube URL parsing | `lib/youtube/parse.ts` | 16 |
| Metadata (Data API, oEmbed fallback, 30-day refresh) | `lib/youtube/metadata.ts`, `lib/resources/ingest.ts` | 20 |
| Vouches (note, 1 to 3 topics, creator disclosure, rolling daily limit) | `lib/vouches/` | 5.2, 23 |
| Follows, Worth It, attribution | `lib/graph/`, `lib/ratings/` | 5.3, 5.8 |
| Taste Graph v1 (topic trust, bounded, derived from outcomes) | `lib/trust/` | 6 |
| Hard rules (channel, topic incl. children, keyword, duration, no Shorts) | `lib/rules/` | 3.2 |
| Circle feed (merge, rules first, rank, explain, diversify, finite) | `lib/feed/` | 14 |
| Rules page, "Never show this channel" with undo | `app/settings/rules/`, `lib/rules/describe.ts` | 7 (flow C) |
| Lists: create, reorder, follow, private; "Up next" on the Circle | `lib/lists/`, `app/lists/` | 5.6 |
| Search: full-text, prefix, @curator, topic, Circle only, rules applied | `lib/search/`, `app/search/` | 16 |
| Pages: Circle, Watch + Worth It, Vouch composer, People, dev sign-in | `app/` | 10, 31 |
| Hacker News import: comments to Vouches, mentions and public lists | `lib/hn/`, `scripts/hn/` | 10, 15.1 |
| Onboarding: 3 to 5 topics, quick "which would you rather watch?" pairs, 5 suggested people or lists | `lib/onboarding/`, `app/onboarding/` | 15.2 |
| Impressions: what was shown (Circle, list up next, search) and opened, per explanation; `/insights` in development | `lib/analytics/`, `app/insights/` | 20, 26 |
| Taste Passport: topic levels, curator success, privacy settings, public page and share card | `lib/passport/`, `app/passport/` | 7 |

## Import Hacker News recommendations

Real starting content: YouTube videos that HN commenters recommended, quoted in their own
words, from the [open-index/hacker-news](https://huggingface.co/datasets/open-index/hacker-news)
dataset (ODC-BY). Each step saves its output under `.data/hn/`, skips work already done, and
can be stopped and re-run.

```bash
# 1. Find comments that link a YouTube video (about 50 MB download per month, deleted after)
python -I scripts/hn/extract_candidates.py --year 2025

# 2. Ask Claude Haiku which links are real recommendations, quote the reason, tag topics.
#    By default this runs through Claude Code (`claude -p`) on your Claude Code login: no API key,
#    and on a subscription it uses plan limits rather than money. --model sonnet judges a little
#    better and uses more of the plan. --via api uses ANTHROPIC_API_KEY instead (2025: about $1).
npx tsx scripts/hn/classify.mts --months 2025-01 --dry-run
npx tsx --env-file=.env.local scripts/hn/classify.mts --months 2025-01

# 3. Write them into the local database (stop `npm run dev` first)
npx tsx --env-file=.env.local scripts/hn/import.mts --months 2025-01 --dry-run
npx tsx --env-file=.env.local scripts/hn/import.mts --months 2025-01
```

The import creates a "Hacker News" curator (a system account nobody can sign in as, exempt
from the daily limit and from analytics), one Vouch per video, a link to every recommending
comment on the watch page, and public lists: "Hacker News Vouched" plus up to 20 topic lists.
Quotes are kept only if they appear word for word in the comment.

## Design decisions worth knowing

- **Trust is derived, not incremented.** Each edge is recomputed from rating counts, so
  re-rating or deleting a vouch can never leave drift. Bounds are approached slowly on both sides.
- **Freshness uses a 72-hour half-life on vouch time**, gentler than HN gravity, so yesterday's
  strong pick is not buried and re-vouched old videos resurface.
- **Rules fail closed.** With a duration rule set, a video of unknown length is hidden.
- **Explanations come from the same numbers as the score** ("You rated 3 of Priya's 3 AI picks Worth It").
- **Lists are paths, not ranking input.** The Circle shows the next unwatched step of each followed list.
- **Rules apply everywhere**: Circle, list "Up next", and search all filter before showing anything.

## Not built yet

Taste Twins and Taste Archetypes (plan 7.3, 7.4), and a production view of `/insights`
(it needs real admin access first). Managed sign-in and hosting are covered below.

## Managed production foundation

Production requires DATABASE_URL and Supabase Auth. Demo sign-in and name-only
account creation are disabled in production. Existing local accounts are never
automatically linked to OAuth identities by name or email.

### Set up Supabase

1. Create a Supabase project and keep its database password in your password manager.
2. Copy the project URL and publishable key into the matching variables in .env.example.
   Copy that template to .env.local for local testing. Keep existing local secrets.
3. Copy the PostgreSQL session-pooler connection URI into DATABASE_URL.
   Use the connection settings recommended by Supabase, including TLS.
   The application uses SQL through the server only. Never expose DATABASE_URL to the browser.
4. Apply migrations from your machine before deploying.

   npx tsx --env-file=.env.local scripts/migrate.mts

   Migrations are explicit and serialized under a database advisory lock.
   Production requests never apply migrations automatically.
5. In Authentication > Providers, enable Google and GitHub and configure each
   provider's client id and secret. Use Supabase's displayed provider callback
   URL in the Google/GitHub provider configuration.
6. In Authentication > URL Configuration, set the Site URL to your final HTTPS
   domain and allow https://YOUR-DOMAIN/auth/callback.
   For local testing also allow http://localhost:3000/auth/callback.
7. Set NEXT_PUBLIC_SITE_URL to the same app origin. Use localhost only in development.

### Set up Vercel

1. Push this project to a Git repository, then import that repository in Vercel.
   This checkout does not currently have a configured Git repository.
2. Select the Next.js preset. Set the root directory to the folder containing package.json.
3. Add DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL,
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, and NEXT_PUBLIC_SITE_URL
   in Vercel's environment settings. Add YOUTUBE_API_KEY for complete video metadata.
4. Use a separate Supabase project/database for previews. Allow preview callback
   URLs explicitly and set the corresponding site origin for each environment.
5. Run tests, typecheck, lint, migrations, and the production build before promotion.
   Windows environments that deny Turbopack junction creation can verify with
   node node_modules/next/dist/bin/next build --webpack.
6. Configure the final domain, then test both OAuth providers in a fresh browser:
   sign-in, onboarding, follow, watch, rate, sign-out, sign-in again.

### Database security boundary

Migration 0008 enables RLS on application tables without granting browser access.
Supabase's browser Data API therefore cannot expose private ratings, trust edges,
or imported data. The application server uses a trusted PostgreSQL connection,
so every server action must continue to derive the user id from getCurrentUser
and check ownership. The adapter is not a replacement for those checks.

### Remaining launch work

The managed-service connection and OAuth redirects need verification against
your actual Supabase and Vercel projects. Public discovery/profile pages, monitoring,
durable ingestion jobs, abuse controls, privacy/account deletion, backup/restore
drills, and complete browser coverage remain part of the release work.
Review npm audit findings before public launch.
