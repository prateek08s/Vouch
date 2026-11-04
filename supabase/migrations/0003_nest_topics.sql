-- Restore the plan's nesting (plan 5.5): Technology > Hardware > GPU, Technology > AI > LLMs, etc.
-- 0002 flattened these under the root, so blocking "Hardware" did not hide GPU videos.

update topics c set parent_topic_id = p.id
from (values
  ('llms',                'ai'),
  ('computer-vision',     'ai'),
  ('rust',                'programming'),
  ('python',              'programming'),
  ('web',                 'programming'),
  ('distributed-systems', 'systems'),
  ('databases',           'systems'),
  ('gpu',                 'hardware'),
  ('cpu',                 'hardware')
) as m(child, parent)
join topics p on p.slug = m.parent
where c.slug = m.child;

-- A topic can never be its own ancestor.
create or replace function topics_no_cycle() returns trigger language plpgsql as $$
begin
  if new.parent_topic_id is not null and exists (
    with recursive up(id) as (
      select new.parent_topic_id
      union
      select t.parent_topic_id from topics t join up on t.id = up.id where t.parent_topic_id is not null
    )
    select 1 from up where id = new.id
  ) then
    raise exception 'topic % would become its own ancestor', new.slug;
  end if;
  return new;
end $$;

create trigger topics_no_cycle before insert or update of parent_topic_id on topics
for each row execute function topics_no_cycle();
