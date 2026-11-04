-- Vouch core schema.
-- Plain Postgres so it runs on Supabase and on PGlite (local dev + tests) unchanged.
-- Product invariants live here as constraints, not only in app code.

create table users (
  id            uuid primary key default gen_random_uuid(),
  username      text not null check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name  text not null check (char_length(display_name) between 1 and 60),
  avatar_url    text,
  bio           text check (char_length(bio) <= 280),
  trust_tier    text not null default 'new' check (trust_tier in ('new', 'standard', 'founding')),
  created_at    timestamptz not null default now()
);
create unique index users_username_key on users (username);

-- A resource is any external thing worth someone's time. YouTube is the first source, not the last.
create table resources (
  id                    uuid primary key default gen_random_uuid(),
  source                text not null check (source in ('youtube')),
  external_id           text not null,
  canonical_url         text not null,
  title                 text not null,
  creator_external_id   text,
  creator_name          text,
  duration_s            integer check (duration_s is null or duration_s >= 0),
  thumbnail_url         text,
  is_short              boolean not null default false,
  published_at          timestamptz,
  metadata_status       text not null default 'ok' check (metadata_status in ('ok', 'partial', 'unavailable')),
  metadata_refreshed_at timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  unique (source, external_id)
);
create index resources_creator_idx on resources (source, creator_external_id);

create table topics (
  id              serial primary key,
  slug            text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name            text not null,
  parent_topic_id integer references topics(id) on delete set null
);

create table resource_topics (
  resource_id uuid not null references resources(id) on delete cascade,
  topic_id    integer not null references topics(id) on delete cascade,
  confidence  real not null default 1.0 check (confidence between 0 and 1),
  source      text not null default 'vouch' check (source in ('vouch', 'ai', 'seed')),
  primary key (resource_id, topic_id)
);

create table vouches (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  resource_id     uuid not null references resources(id) on delete cascade,
  note            text check (char_length(note) <= 280),
  is_own_content  boolean not null default false,
  is_daily_vouch  boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, resource_id)
);
create index vouches_resource_idx on vouches (resource_id);
create index vouches_user_created_idx on vouches (user_id, created_at desc);

create table vouch_topics (
  vouch_id uuid not null references vouches(id) on delete cascade,
  topic_id integer not null references topics(id) on delete cascade,
  primary key (vouch_id, topic_id)
);

create table follows (
  follower_id uuid not null references users(id) on delete cascade,
  followee_id uuid not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee_idx on follows (followee_id);

-- Private by default: ratings are never exposed per user.
create table ratings (
  user_id              uuid not null references users(id) on delete cascade,
  resource_id          uuid not null references resources(id) on delete cascade,
  worth_it             boolean not null,
  attribution_vouch_id uuid references vouches(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (user_id, resource_id)
);
create index ratings_resource_idx on ratings (resource_id);

create table trust_edges (
  user_id     uuid not null references users(id) on delete cascade,
  curator_id  uuid not null references users(id) on delete cascade,
  base_weight real not null default 1.0 check (base_weight between 0.2 and 3.0),
  updated_at  timestamptz not null default now(),
  primary key (user_id, curator_id),
  check (user_id <> curator_id)
);

create table topic_trust_edges (
  user_id      uuid not null references users(id) on delete cascade,
  curator_id   uuid not null references users(id) on delete cascade,
  topic_id     integer not null references topics(id) on delete cascade,
  weight       real not null default 1.0 check (weight between 0.2 and 3.0),
  sample_count integer not null default 0 check (sample_count >= 0),
  worth_count  integer not null default 0 check (worth_count >= 0 and worth_count <= sample_count),
  confidence   real not null default 0 check (confidence between 0 and 1),
  updated_at   timestamptz not null default now(),
  primary key (user_id, curator_id, topic_id),
  check (user_id <> curator_id)
);

create table lists (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references users(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 120),
  description text check (char_length(description) <= 500),
  is_public   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table list_items (
  list_id     uuid not null references lists(id) on delete cascade,
  resource_id uuid not null references resources(id) on delete cascade,
  position    integer not null check (position >= 0),
  note        text check (char_length(note) <= 280),
  primary key (list_id, resource_id),
  unique (list_id, position) deferrable initially deferred
);

create table list_follows (
  user_id    uuid not null references users(id) on delete cascade,
  list_id    uuid not null references lists(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, list_id)
);

create table rules (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  kind       text not null check (kind in ('channel', 'topic', 'keyword', 'min_duration', 'max_duration', 'no_shorts')),
  value      text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, kind, value)
);

create table watch_progress (
  user_id     uuid not null references users(id) on delete cascade,
  resource_id uuid not null references resources(id) on delete cascade,
  position_s  integer not null default 0 check (position_s >= 0),
  updated_at  timestamptz not null default now(),
  primary key (user_id, resource_id)
);

create table recommendation_impressions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references users(id) on delete cascade,
  resource_id      uuid not null references resources(id) on delete cascade,
  source_type      text not null check (source_type in ('circle', 'today', 'discover', 'list', 'search')),
  explanation_code text not null,
  shown_at         timestamptz not null default now(),
  opened_at        timestamptz
);

-- Provenance: which vouch carried this resource to this user (the Vouch Chain).
create table vouch_attribution (
  user_id            uuid not null references users(id) on delete cascade,
  resource_id        uuid not null references resources(id) on delete cascade,
  source_vouch_id    uuid references vouches(id) on delete set null,
  source_curator_id  uuid references users(id) on delete set null,
  created_at         timestamptz not null default now(),
  primary key (user_id, resource_id)
);

-- Product analytics from day one. Behavioral events, not surveillance.
create table events (
  id         bigserial primary key,
  user_id    uuid references users(id) on delete set null,
  name       text not null check (name in (
               'signup', 'onboarding_complete', 'follow', 'vouch_created',
               'recommendation_impression', 'recommendation_opened', 'watch_started',
               'worth_it', 'not_worth_it', 'rule_created', 'passport_shared')),
  props      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index events_name_created_idx on events (name, created_at);
