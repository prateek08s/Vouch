-- Onboarding (plan 15.2): topics first, a few quick choices, then curators and lists to follow.

-- Null until the person finishes onboarding. Accounts that existed before onboarding are treated as done.
alter table users add column onboarded_at timestamptz;
update users set onboarded_at = created_at;

-- The topics someone said they care about. Used to pick choices and suggestions now, and Discover later.
create table user_topics (
  user_id    uuid not null references users(id) on delete cascade,
  topic_id   integer not null references topics(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, topic_id)
);
