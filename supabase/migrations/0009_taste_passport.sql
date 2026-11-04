-- Taste Passport privacy (plan 7, 31): private until the person chooses to share it.
-- The public version is built from vouches only, never from private Worth-It ratings.
alter table users add column passport_public boolean not null default false;
-- Whether the public version shows curator success (Worth-It rate of their picks, people helped).
alter table users add column passport_show_success boolean not null default true;
