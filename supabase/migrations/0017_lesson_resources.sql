create table lesson_resources (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null,
  resource_id uuid not null,
  kind text not null check (kind in ('code', 'notebook', 'paper', 'reading', 'other')),
  title text not null check (char_length(title) between 1 and 120),
  url text not null check (char_length(url) <= 2048 and url like 'https://%'),
  created_at timestamptz not null default now(),
  foreign key (list_id, resource_id) references list_items(list_id, resource_id) on delete cascade,
  unique (list_id, resource_id, url)
);
alter table lesson_resources enable row level security;
create index lesson_resources_lesson_idx on lesson_resources(list_id, resource_id, created_at);
