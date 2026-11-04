-- Identity mapping is optional for existing imported and local demo accounts.
alter table users add column auth_user_id uuid unique;

-- The browser uses Auth only. Application data is served through authorized server code.
-- RLS without browser policies prevents accidental REST access on a Supabase project.
do $$
declare item record;
begin
  for item in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', item.tablename);
  end loop;
end $$;
