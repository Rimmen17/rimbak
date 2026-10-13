// Stand-in for Supabase so the site can be tried without a database.
// Used only while config.supabaseUrl is empty. Data stays in this browser.
import { startOfDay } from './dates.js';

const KEY = 'familiekalender-demo';
const PASSWORD = 'demo123';
const USERS = [
  { id: 'u-admin', name: 'Admin', isAdmin: true },
  { id: 'u-mor', name: 'Mor', isAdmin: false },
  { id: 'u-far', name: 'Far', isAdmin: false },
  { id: 'u-bror', name: 'Bror', isAdmin: false },
];

function seed() {
  const at = (days, hour) => {
    const d = startOfDay();
    d.setDate(d.getDate() + days);
    d.setHours(hour);
    return d.toISOString();
  };
  return {
    session: null,
    events: [
      { id: 'e-1', title: 'Familiemiddag', description: 'Vi laver lasagne.', location: 'Hos mor og far', startsAt: at(3, 18), endsAt: at(3, 21), createdBy: 'u-mor' },
      { id: 'e-2', title: 'Fødselsdag', description: '', location: '', startsAt: at(10, 14), endsAt: null, createdBy: 'u-admin' },
    ],
    responses: [
      { eventId: 'e-1', userId: 'u-mor', status: 'joining', note: '' },
      { eventId: 'e-1', userId: 'u-bror', status: 'late', note: 'Kommer ca. 18.30' },
    ],
  };
}

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? seed();
  } catch {
    return seed();
  }
}

function save(db) {
  localStorage.setItem(KEY, JSON.stringify(db));
}

function current(db) {
  const user = USERS.find((u) => u.id === db.session);
  if (!user) throw new Error('Du er ikke logget ind');
  return user;
}

export async function init() {}

export async function getSession() {
  return USERS.find((u) => u.id === load().session) ?? null;
}

export async function signIn(name, password) {
  const user = USERS.find((u) => u.name.toLowerCase() === name.trim().toLowerCase());
  if (!user || password !== PASSWORD) throw new Error('Forkert navn eller adgangskode');
  const db = load();
  db.session = user.id;
  save(db);
  return user;
}

export async function signOut() {
  const db = load();
  db.session = null;
  save(db);
}

export async function listProfiles() {
  return USERS;
}

export async function listEvents(fromIso) {
  return load().events
    .filter((e) => e.startsAt >= fromIso)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export async function listResponses(eventIds) {
  return load().responses.filter((r) => eventIds.includes(r.eventId));
}

// Same rule as the database: the creator or the admin.
function mayChange(db, id) {
  const user = current(db);
  const existing = db.events.find((e) => e.id === id);
  if (existing && !user.isAdmin && existing.createdBy !== user.id) {
    throw new Error('Du kan kun ændre dine egne begivenheder');
  }
  return { user, existing };
}

export async function saveEvent(ev) {
  const db = load();
  const { user, existing } = mayChange(db, ev.id);
  const row = { ...ev, id: ev.id || crypto.randomUUID(), createdBy: existing?.createdBy ?? user.id };
  db.events = db.events.filter((e) => e.id !== row.id).concat(row);
  save(db);
}

export async function deleteEvent(id) {
  const db = load();
  mayChange(db, id);
  db.events = db.events.filter((e) => e.id !== id);
  db.responses = db.responses.filter((r) => r.eventId !== id);
  save(db);
}

export async function setResponse(eventId, status, note) {
  const db = load();
  const userId = current(db).id;
  db.responses = db.responses
    .filter((r) => !(r.eventId === eventId && r.userId === userId))
    .concat({ eventId, userId, status, note });
  save(db);
}
