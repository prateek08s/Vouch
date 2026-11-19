-- Indexed full-text search (review, November 2026). Search used to rebuild a tsvector for every
-- vouched video on every query. Now each video carries a stored search document:
--   title (A) + channel (B) + topics, notes and curator names from its vouches (C)
-- kept current by triggers, and searched through a GIN index.

alter table resources add column search_extra text not null default '';
alter table resources add column search_doc tsvector generated always as (
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(creator_name, '')), 'B') ||
  setweight(to_tsvector('english', search_extra), 'C')
) stored;
create index resources_search_idx on resources using gin (search_doc);

create or replace function refresh_resource_search(rid uuid) returns void language sql as $$
  update resources r set search_extra = coalesce((
    select string_agg(distinct s.words, ' ')
    from (
      select t.name as words from vouches v
        join vouch_topics vt on vt.vouch_id = v.id join topics t on t.id = vt.topic_id
        where v.resource_id = rid
      union all
      select v.note from vouches v where v.resource_id = rid and v.note is not null
      union all
      select u.display_name || ' ' || u.username from vouches v join users u on u.id = v.user_id
        where v.resource_id = rid
    ) s
  ), '')
  where r.id = rid;
$$;

create or replace function vouches_refresh_search() returns trigger language plpgsql as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then perform refresh_resource_search(new.resource_id); end if;
  if tg_op in ('DELETE', 'UPDATE') then perform refresh_resource_search(old.resource_id); end if;
  return null;
end $$;

create trigger vouches_refresh_search after insert or update of note, resource_id or delete on vouches
for each row execute function vouches_refresh_search();

create or replace function vouch_topics_refresh_search() returns trigger language plpgsql as $$
declare rid uuid;
begin
  select v.resource_id into rid from vouches v where v.id = coalesce(new.vouch_id, old.vouch_id);
  if rid is not null then perform refresh_resource_search(rid); end if;
  return null;
end $$;

create trigger vouch_topics_refresh_search after insert or delete on vouch_topics
for each row execute function vouch_topics_refresh_search();

-- Backfill every video that has vouches.
select refresh_resource_search(id) from resources r where exists (select 1 from vouches v where v.resource_id = r.id);
