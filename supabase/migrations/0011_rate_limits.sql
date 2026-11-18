-- Fixed-window rate limits (lib/limits). One row per bucket, key and window; old windows are pruned.
create table rate_limits (
  bucket       text not null,
  key          text not null,
  window_start timestamptz not null,
  hits         integer not null default 0 check (hits >= 0),
  primary key (bucket, key, window_start)
);
create index rate_limits_window_idx on rate_limits (window_start);

-- Every new table: RLS on with no browser policies (see 0008). Only server code reads it.
alter table rate_limits enable row level security;
