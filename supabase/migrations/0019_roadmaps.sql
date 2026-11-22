create table roadmaps (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references users(id) on delete cascade,
 title text not null check (char_length(title) between 1 and 120),
 description text not null default '' check (char_length(description) <= 1000),
 is_public boolean not null default false,
 updated_at timestamptz not null default now()
);
create table roadmap_stages (
 roadmap_id uuid not null references roadmaps(id) on delete cascade,
 position integer not null check (position between 0 and 19),
 list_id uuid references lists(id) on delete set null,
 primary key (roadmap_id, position),
 unique (roadmap_id, list_id)
);
alter table roadmaps enable row level security;
alter table roadmap_stages enable row level security;
create index roadmaps_owner_idx on roadmaps(owner_id);
