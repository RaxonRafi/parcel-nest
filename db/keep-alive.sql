-- Run once in the Supabase SQL editor.
create table if not exists keep_alive (
  id int primary key,
  ping timestamptz default now()
);

insert into keep_alive (id) values (1)
on conflict (id) do nothing;

-- Table is only touched by the service role key, so keep RLS on with no policies.
alter table keep_alive enable row level security;
