import { el } from './dom.js';
import * as dates from './dates.js';

export const STATUSES = [
  { id: 'joining', label: 'Kommer' },
  { id: 'late', label: 'Bliver forsinket' },
  { id: 'not_joining', label: 'Kommer ikke' },
];

const WEEKDAYS = ['man', 'tir', 'ons', 'tor', 'fre', 'lør', 'søn'];

function answerButtons(ev, mine, noteInput, h) {
  return el('div', { class: 'answers', role: 'group', 'aria-label': 'Dit svar' },
    STATUSES.map((s) => el('button', {
      type: 'button',
      class: `answer ${s.id}`,
      'aria-pressed': String(mine?.status === s.id),
      text: s.label,
      onclick: () => h.onAnswer(ev.id, s.id, noteInput.value.trim()),
    })));
}

function answerSummary(ev, state) {
  const answers = state.responses.get(ev.id) ?? [];
  const nameOf = (id) => state.profiles.find((p) => p.id === id)?.name ?? 'Ukendt';
  const rows = STATUSES.map((s) => {
    const people = answers.filter((a) => a.status === s.id);
    return el('li', { class: `group ${s.id}` },
      el('span', { class: 'group-label', text: `${s.label} (${people.length})` }),
      people.map((a) => el('span', { class: 'person' },
        nameOf(a.userId),
        a.note && el('em', { text: ` "${a.note}"` }))));
  });
  const missing = state.profiles.filter((p) => !answers.some((a) => a.userId === p.id));
  if (missing.length) {
    rows.push(el('li', { class: 'group missing' },
      el('span', { class: 'group-label', text: `Mangler svar (${missing.length})` }),
      missing.map((p) => el('span', { class: 'person', text: p.name }))));
  }
  return el('ul', { class: 'summary' }, rows);
}

function adminButtons(ev, h) {
  const del = el('button', { type: 'button', class: 'link danger', text: 'Slet' });
  // Two clicks instead of a browser confirm box.
  del.addEventListener('click', () => {
    if (del.dataset.armed) return h.onDelete(ev.id);
    del.dataset.armed = '1';
    del.textContent = 'Tryk igen for at slette';
    setTimeout(() => {
      delete del.dataset.armed;
      del.textContent = 'Slet';
    }, 4000);
  });
  return el('div', { class: 'admin' },
    el('button', { type: 'button', class: 'link', text: 'Rediger', onclick: () => h.onEdit(ev) }),
    del);
}

function eventCard(ev, state, h) {
  const mine = (state.responses.get(ev.id) ?? []).find((a) => a.userId === state.user.id);
  const parts = dates.dateParts(ev.startsAt);
  const noteInput = el('input', {
    class: 'note',
    type: 'text',
    maxlength: '120',
    placeholder: 'Besked, fx "20 minutter forsinket"',
    'aria-label': 'Besked til dit svar',
    hidden: !mine,
  });
  noteInput.value = mine?.note ?? '';
  noteInput.addEventListener('change', () => h.onAnswer(ev.id, mine.status, noteInput.value.trim()));

  const where = [dates.formatRange(ev.startsAt, ev.endsAt), ev.location].filter(Boolean).join(' · ');
  const creator = state.profiles.find((p) => p.id === ev.createdBy)?.name;
  const mayChange = state.user.isAdmin || ev.createdBy === state.user.id;
  return el('article', { class: 'event', id: `event-${ev.id}` },
    el('div', { class: 'date', 'aria-hidden': 'true' },
      el('span', { class: 'wd', text: parts.weekday }),
      el('span', { class: 'dd', text: parts.day }),
      el('span', { class: 'mm', text: parts.month })),
    el('div', { class: 'body' },
      el('h2', { text: ev.title }),
      el('p', { class: 'when' }, el('span', { class: 'sr', text: `${dates.formatDay(ev.startsAt)}, ` }), where),
      ev.description && el('p', { class: 'desc', text: ev.description }),
      answerButtons(ev, mine, noteInput, h),
      noteInput,
      answerSummary(ev, state),
      creator && el('p', { class: 'creator', text: `Oprettet af ${creator}` }),
      mayChange && adminButtons(ev, h)));
}

export function renderList(container, state, h) {
  const today = dates.startOfDay().toISOString();
  const shown = state.day
    ? state.events.filter((e) => dates.dateKey(new Date(e.startsAt)) === state.day)
    : state.events.filter((e) => e.startsAt >= today);

  const head = state.day && el('p', { class: 'filter' },
    `Viser ${dates.formatDay(`${state.day}T12:00`)}. `,
    el('button', { type: 'button', class: 'link', text: 'Vis alle kommende', onclick: () => h.onPickDay(null) }));
  const empty = !shown.length && el('p', { class: 'empty', text: state.day ? 'Ingen begivenheder den dag.' : 'Ingen kommende begivenheder.' });

  container.replaceChildren(...[head, empty, ...shown.map((e) => eventCard(e, state, h))].filter(Boolean));
}

export function renderMonth(container, state, h) {
  const cursor = state.cursor;
  const todayKey = dates.dateKey(new Date());
  const counts = new Map();
  for (const e of state.events) {
    const key = dates.dateKey(new Date(e.startsAt));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const cells = dates.monthGrid(cursor.getFullYear(), cursor.getMonth()).map((d) => {
    const key = dates.dateKey(d);
    const n = counts.get(key) ?? 0;
    const cls = ['day',
      d.getMonth() !== cursor.getMonth() && 'other',
      key === todayKey && 'today',
      key === state.day && 'selected',
      n && 'has'].filter(Boolean).join(' ');
    return el('button', {
      type: 'button',
      class: cls,
      'aria-label': `${dates.formatDay(`${key}T12:00`)}${n ? `, ${n} ${n === 1 ? 'begivenhed' : 'begivenheder'}` : ''}`,
      'aria-pressed': String(key === state.day),
      onclick: () => h.onPickDay(key === state.day ? null : key),
    }, el('span', { text: String(d.getDate()) }), n > 0 && el('i', { class: 'dot', 'aria-hidden': 'true' }));
  });

  container.replaceChildren(
    el('div', { class: 'month-head' },
      el('button', { type: 'button', class: 'nav', 'aria-label': 'Forrige måned', text: '‹', onclick: () => h.onMonth(-1) }),
      el('h2', { text: dates.formatMonth(cursor) }),
      el('button', { type: 'button', class: 'nav', 'aria-label': 'Næste måned', text: '›', onclick: () => h.onMonth(1) })),
    el('div', { class: 'grid' },
      WEEKDAYS.map((w) => el('span', { class: 'wk', text: w, 'aria-hidden': 'true' })),
      cells));
}
