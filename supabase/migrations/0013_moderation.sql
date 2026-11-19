-- Moderation (review, November 2026): reports, hidden vouches, suspended accounts, admins.

alter table users add column is_admin boolean not null default false;
alter table users add column suspended_at timestamptz;

-- A hidden vouch stays in the database (and in its author's data export) but appears nowhere.
alter table vouches add column hidden_at timestamptz;
create index vouches_visible_resource_idx on vouches (resource_id) where hidden_at is null;

create table reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references users(id) on delete cascade,
  vouch_id    uuid not null references vouches(id) on delete cascade,
  reason      text not null check (reason in ('spam', 'harassment', 'misleading', 'other')),
  details     text check (char_length(details) <= 500),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolution  text check (resolution in ('hidden', 'dismissed')),
  resolved_by uuid references users(id) on delete set null,
  unique (reporter_id, vouch_id),
  check ((resolved_at is null) = (resolution is null))
);
create index reports_open_idx on reports (created_at) where resolved_at is null;

alter table reports enable row level security;

-- Hidden vouches leave the search index too: same function, visible vouches only.
create or replace function refresh_resource_search(rid uuid) returns void language sql as $$
  update resources r set search_extra = coalesce((
    select string_agg(distinct s.words, ' ')
    from (
      select t.name as words from vouches v
        join vouch_topics vt on vt.vouch_id = v.id join topics t on t.id = vt.topic_id
        where v.resource_id = rid and v.hidden_at is null
      union all
      select v.note from vouches v where v.resource_id = rid and v.note is not null and v.hidden_at is null
      union all
      select u.display_name || ' ' || u.username from vouches v join users u on u.id = v.user_id
        where v.resource_id = rid and v.hidden_at is null
    ) s
  ), '')
  where r.id = rid;
$$;

drop trigger vouches_refresh_search on vouches;
create trigger vouches_refresh_search after insert or update of note, resource_id, hidden_at or delete on vouches
for each row execute function vouches_refresh_search();
