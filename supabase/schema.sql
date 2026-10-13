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

-- Notifications (web push). The sending is done by the function in
-- supabase/functions/notify; this part stores each device's subscription,
-- remembers what has been sent, and calls the function.

create table public.push_subscriptions (
  endpoint text primary key check (
    char_length(endpoint) <= 1000
    -- Only the browsers' own push services, so the function never posts anywhere else.
    and endpoint ~ '^https://[a-z0-9.-]+\.(push\.apple\.com|googleapis\.com|mozilla\.com|notify\.windows\.com)/'
  ),
  user_id uuid not null references public.profiles on delete cascade,
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon;
grant select, delete on public.push_subscriptions to authenticated;

-- Subscriptions: each person sees and removes only their own.
create policy "own subscription read" on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());
create policy "own subscription delete" on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());

-- Saving goes through this function, so a device that changes hands follows
-- whoever is logged in on it now.
create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not logged in';
  end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$;

revoke execute on function public.save_push_subscription(text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;

-- When each event was announced and when its reminder went out.
alter table public.events
  add column announced_at timestamptz,
  add column reminded_at timestamptz;

-- Events that existed before notifications are not announced after the fact.
update public.events set announced_at = now() where announced_at is null;

-- A moved event gets its reminder again.
create function public.rearm_reminder()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.starts_at is distinct from old.starts_at then
    new.reminded_at := null;
  end if;
  return new;
end;
$$;

create trigger events_rearm_reminder
  before update on public.events
  for each row execute function public.rearm_reminder();

-- The sending function reads and writes with the service role.
grant select on public.profiles to service_role;
grant select, update on public.events to service_role;
grant select, delete on public.push_subscriptions to service_role;

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Wakes the sending function. It takes no input and decides from the tables
-- what is due, so calling it too often sends nothing extra.
-- The function only answers a call that carries one of the project's keys.
-- Store the legacy anon key (Project Settings, API Keys, Legacy) once, by hand:
--   select vault.create_secret('<anon key>', 'notify_jwt');
create function public.post_notify()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  key text;
begin
  select decrypted_secret into key from vault.decrypted_secrets where name = 'notify_jwt';
  perform net.http_post(
    url := 'https://qyuinwidetufdyrjcjba.supabase.co/functions/v1/notify',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || key)
  );
end;
$$;

revoke execute on function public.post_notify() from public, anon, authenticated;

create function public.call_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.post_notify();
  return null;
exception when others then
  -- A new event is never refused because the notification could not be queued.
  return null;
end;
$$;

revoke execute on function public.call_notify() from public, anon, authenticated;

create trigger events_announce
  after insert on public.events
  for each statement execute function public.call_notify();

-- Every ten minutes for the reminders (and any announcement the trigger missed).
select cron.schedule('rimbak-notify', '*/10 * * * *', 'select public.post_notify()');

-- Notifications about the answers to events you created. On to begin with;
-- each person can turn it off.
alter table public.profiles add column notify_responses boolean not null default true;

create function public.set_response_notifications(p_on boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles set notify_responses = coalesce(p_on, false) where id = auth.uid();
$$;

revoke execute on function public.set_response_notifications(boolean) from public, anon;
grant execute on function public.set_response_notifications(boolean) to authenticated;

-- Answers waiting to be sent out. Only the sending function touches this table.
create table public.response_notices (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.events on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  status text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

alter table public.response_notices enable row level security;
revoke all on public.response_notices from anon, authenticated;
grant select, delete on public.response_notices to service_role;

create function public.queue_response_notice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.status = old.status and new.note = old.note then
    return null;
  end if;
  -- Answers to events that have already started are not news.
  if not exists (select 1 from public.events e where e.id = new.event_id and e.starts_at > now()) then
    return null;
  end if;
  insert into public.response_notices (event_id, user_id, status, note)
  values (new.event_id, new.user_id, new.status, new.note);
  perform public.post_notify();
  return null;
exception when others then
  -- An answer is never refused because the notification could not be queued.
  return null;
end;
$$;

revoke execute on function public.queue_response_notice() from public, anon, authenticated;

create trigger responses_notice
  after insert or update on public.responses
  for each row execute function public.queue_response_notice();
