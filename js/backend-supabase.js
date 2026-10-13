import { nameToEmail } from './dates.js';

let sb;
let domain;

export async function init(config) {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
  sb = createClient(config.supabaseUrl, config.supabaseAnonKey);
  domain = config.loginDomain;
}

function check({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

async function loadProfile(id) {
  const p = check(await sb.from('profiles').select('id, name, is_admin').eq('id', id).single());
  return { id: p.id, name: p.name, isAdmin: p.is_admin };
}

export async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session ? loadProfile(data.session.user.id) : null;
}

export async function signIn(name, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email: nameToEmail(name, domain), password });
  if (error) throw new Error('Forkert navn eller adgangskode');
  return loadProfile(data.user.id);
}

export async function signOut() {
  await sb.auth.signOut();
}

export async function listProfiles() {
  const rows = check(await sb.from('profiles').select('id, name, is_admin').order('name'));
  return rows.map((p) => ({ id: p.id, name: p.name, isAdmin: p.is_admin }));
}

export async function listEvents(fromIso) {
  const rows = check(await sb.from('events').select('*').gte('starts_at', fromIso).order('starts_at'));
  return rows.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    location: e.location,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
  }));
}

export async function listResponses(eventIds) {
  if (!eventIds.length) return [];
  const rows = check(await sb.from('responses').select('event_id, user_id, status, note').in('event_id', eventIds));
  return rows.map((r) => ({ eventId: r.event_id, userId: r.user_id, status: r.status, note: r.note }));
}

export async function saveEvent(ev) {
  const row = {
    title: ev.title,
    description: ev.description,
    location: ev.location,
    starts_at: ev.startsAt,
    ends_at: ev.endsAt,
  };
  check(ev.id ? await sb.from('events').update(row).eq('id', ev.id) : await sb.from('events').insert(row));
}

export async function deleteEvent(id) {
  check(await sb.from('events').delete().eq('id', id));
}

export async function setResponse(eventId, status, note) {
  const { data } = await sb.auth.getUser();
  check(await sb.from('responses').upsert({
    event_id: eventId,
    user_id: data.user.id,
    status,
    note,
    updated_at: new Date().toISOString(),
  }));
}
