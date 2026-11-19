-- Signed-out measurement for the note experiment (critique, change 5).
-- anon_id is a random browser ID from a first-party cookie; it is never linked to an account.
-- variant: 'note' cards show the Hacker News reason, 'nonote' cards don't. Rows older than
-- 90 days are deleted by the daily cron.
create table anon_events (
  id          bigint generated always as identity primary key,
  anon_id     uuid not null,
  variant     text not null check (variant in ('note', 'nonote')),
  kind        text not null check (kind in ('impression', 'open', 'worth', 'not')),
  resource_id uuid not null references resources(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (anon_id, kind, resource_id)
);
create index anon_events_report_idx on anon_events (kind, variant);
create index anon_events_created_idx on anon_events (created_at);
alter table anon_events enable row level security;
