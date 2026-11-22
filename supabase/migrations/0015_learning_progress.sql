-- Compatible with local builds that applied the earlier development filename.
-- Learning state is private and independent of endorsement or rating.
alter table watch_progress
  add column if not exists status text not null default 'in_progress'
    check (status in ('in_progress', 'watched', 'skipped')),
  add column if not exists sampled_at timestamptz not null default now();

-- Preserve the previous application's interpretation of existing ratings.
-- Ratings created after this migration do not change playback progress.
insert into watch_progress (user_id, resource_id, position_s, status, updated_at, sampled_at)
select user_id, resource_id, 0, 'watched', updated_at, updated_at from ratings
where not exists (select 1 from schema_migrations where name = '0014_learning_progress.sql')
on conflict (user_id, resource_id) do nothing;

create index if not exists watch_progress_user_updated_idx on watch_progress (user_id, updated_at desc);
create table if not exists saved_resources (
  user_id uuid not null references users(id) on delete cascade,
  resource_id uuid not null references resources(id) on delete cascade,
  saved_at timestamptz not null default now(),
  primary key (user_id, resource_id)
);
alter table saved_resources enable row level security;
create index if not exists saved_resources_user_saved_idx on saved_resources (user_id, saved_at desc);
