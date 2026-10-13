import { config } from './config.js';
import * as dates from './dates.js';
import { renderList, renderMonth } from './views.js';

const demo = !config.supabaseUrl;
const backend = await import(demo ? './backend-demo.js' : './backend-supabase.js');

const $ = (id) => document.getElementById(id);
const state = {
  user: null,
  profiles: [],
  events: [],
  responses: new Map(),
  view: 'list',
  cursor: new Date(),
  day: null,
};

function showStatus(message) {
  $('status').textContent = message ?? '';
  $('status').hidden = !message;
}

// Runs an action and shows a readable message instead of failing silently.
async function run(action) {
  try {
    showStatus(null);
    await action();
  } catch (err) {
    console.error(err);
    showStatus(err.message || 'Noget gik galt. Prøv igen.');
  }
}

function render() {
  $('tab-list').setAttribute('aria-selected', String(state.view === 'list'));
  $('tab-month').setAttribute('aria-selected', String(state.view === 'month'));
  $('month').hidden = state.view !== 'month';
  if (state.view === 'month') renderMonth($('month'), state, handlers);
  renderList($('list'), state, handlers);
}

async function refresh() {
  // The list starts today; the month view may reach back to the first of a shown month.
  const today = dates.startOfDay();
  const monthStart = new Date(state.cursor.getFullYear(), state.cursor.getMonth(), 1);
  const from = state.view === 'month' && monthStart < today ? monthStart : today;

  const [profiles, events] = await Promise.all([backend.listProfiles(), backend.listEvents(from.toISOString())]);
  const responses = await backend.listResponses(events.map((e) => e.id));

  state.profiles = profiles;
  state.events = events;
  state.responses = new Map();
  for (const r of responses) {
    if (!state.responses.has(r.eventId)) state.responses.set(r.eventId, []);
    state.responses.get(r.eventId).push(r);
  }
  render();
}

const handlers = {
  onAnswer: (eventId, status, note) => run(async () => {
    await backend.setResponse(eventId, status, note.slice(0, 120));
    await refresh();
  }),
  onEdit: (ev) => openDialog(ev),
  onDelete: (id) => run(async () => {
    await backend.deleteEvent(id);
    await refresh();
  }),
  onPickDay: (key) => {
    state.day = key;
    render();
  },
  onMonth: (delta) => run(async () => {
    state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + delta, 1);
    state.day = null;
    await refresh();
  }),
};

function showLogin() {
  state.user = null;
  state.view = 'list';
  state.day = null;
  state.cursor = new Date();
  $('main-view').hidden = true;
  $('login-view').hidden = false;
  $('demo-banner').hidden = !demo;
  $('login-form').reset();
  $('login-name').focus();
}

async function showMain() {
  $('login-view').hidden = true;
  $('main-view').hidden = false;
  $('user-name').textContent = state.user.name;
  $('new-event').hidden = !state.user.isAdmin;
  await refresh();
}

function openDialog(ev) {
  const form = $('event-form');
  form.reset();
  form.dataset.id = ev?.id ?? '';
  $('event-error').hidden = true;
  $('dialog-title').textContent = ev ? 'Rediger begivenhed' : 'Ny begivenhed';
  if (ev) {
    const start = dates.splitIso(ev.startsAt);
    form.elements.title.value = ev.title;
    form.elements.date.value = start.date;
    form.elements.start.value = start.time;
    form.elements.end.value = ev.endsAt ? dates.splitIso(ev.endsAt).time : '';
    form.elements.location.value = ev.location;
    form.elements.description.value = ev.description;
  } else {
    form.elements.date.value = state.day ?? dates.dateKey(new Date());
  }
  $('event-dialog').showModal();
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const error = $('login-error');
  error.hidden = true;
  try {
    state.user = await backend.signIn($('login-name').value, $('login-password').value);
    await showMain();
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  }
});

$('logout').addEventListener('click', () => run(async () => {
  await backend.signOut();
  showLogin();
}));

$('tab-list').addEventListener('click', () => run(async () => {
  state.view = 'list';
  state.day = null;
  await refresh();
}));

$('tab-month').addEventListener('click', () => run(async () => {
  state.view = 'month';
  await refresh();
}));

$('new-event').addEventListener('click', () => openDialog(null));
$('event-cancel').addEventListener('click', () => $('event-dialog').close());

$('event-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const error = $('event-error');
  error.hidden = true;
  try {
    const title = f.title.value.trim();
    if (!title) throw new Error('Skriv en titel');
    await backend.saveEvent({
      id: e.target.dataset.id || null,
      title,
      description: f.description.value.trim(),
      location: f.location.value.trim(),
      startsAt: dates.toIso(f.date.value, f.start.value),
      endsAt: dates.endIso(f.date.value, f.start.value, f.end.value),
    });
    $('event-dialog').close();
    // Drop any day filter so the saved event is in view.
    state.day = null;
    await refresh();
  } catch (err) {
    error.textContent = err.message || 'Kunne ikke gemme. Prøv igen.';
    error.hidden = false;
  }
});

await run(async () => {
  await backend.init(config);
  state.user = await backend.getSession();
  if (state.user) await showMain();
  else showLogin();
});
