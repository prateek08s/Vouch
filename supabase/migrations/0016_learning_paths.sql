-- Path metadata extends a collection. Its existing ownership and visibility remain authoritative.
create table learning_paths (
  list_id uuid primary key references lists(id) on delete cascade,
  level text not null check (level in ('beginner', 'intermediate', 'advanced')),
  prerequisites text[] not null default '{}',
  outcomes text[] not null,
  updated_at timestamptz not null default now(),
  check (cardinality(prerequisites) <= 8),
  check (cardinality(outcomes) between 1 and 8)
);
alter table learning_paths enable row level security;
