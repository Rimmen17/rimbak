-- Family calendar: tables and access rules.
-- Run once in the Supabase SQL editor of a new project.

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  is_admin boolean not null default false
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  location text not null default '' check (char_length(location) <= 80),
  starts_at timestamptz not null,
  ends_at timestamptz check (ends_at is null or ends_at > starts_at),
  created_by uuid default auth.uid() references public.profiles on delete set null,
  created_at timestamptz not null default now()
);

create table public.responses (
  event_id uuid not null references public.events on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  status text not null check (status in ('joining', 'late', 'not_joining')),
  note text not null default '' check (char_length(note) <= 120),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index events_starts_at_idx on public.events (starts_at);

-- Every new login gets a profile. The name comes from the user's metadata
-- ("name") when set, otherwise from the part of the email before the @.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), initcap(split_part(new.email, '@', 1)))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;

alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.responses enable row level security;

-- Nothing for visitors who are not logged in.
revoke all on public.profiles, public.events, public.responses from anon;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.events, public.responses to authenticated;

-- Profiles: the family can see who is in it. Changes happen in the dashboard only.
create policy "family reads profiles" on public.profiles
  for select to authenticated using (true);

-- Events: everyone logged in reads and may add their own;
-- only the creator or the admin may edit or delete one.
create policy "family reads events" on public.events
  for select to authenticated using (true);
create policy "family adds events" on public.events
  for insert to authenticated with check (created_by = auth.uid());
create policy "creator or admin edits events" on public.events
  for update to authenticated
  using (public.is_admin() or created_by = auth.uid())
  with check (public.is_admin() or created_by = auth.uid());
create policy "creator or admin deletes events" on public.events
  for delete to authenticated using (public.is_admin() or created_by = auth.uid());

-- Responses: everyone logged in reads, each person writes only their own.
create policy "family reads responses" on public.responses
  for select to authenticated using (true);
create policy "own response insert" on public.responses
  for insert to authenticated with check (user_id = auth.uid());
create policy "own response update" on public.responses
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own response delete" on public.responses
  for delete to authenticated using (user_id = auth.uid());

-- After creating the accounts (Authentication, Users, "Add user", auto confirm),
-- make one of them the admin:
--   update public.profiles set is_admin = true where name = 'Christian';
