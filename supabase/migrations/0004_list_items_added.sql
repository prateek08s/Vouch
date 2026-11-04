-- Lists: when an item was added (for "recently added" and future digests), and lookups by list.
alter table list_items add column added_at timestamptz not null default now();
create index list_follows_list_idx on list_follows (list_id);
create index lists_owner_idx on lists (owner_id, created_at desc);
