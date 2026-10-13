const LOCALE = 'da-DK';
const pad = (n) => String(n).padStart(2, '0');

// Local calendar day as YYYY-MM-DD.
export function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function toIso(date, time) {
  const d = new Date(`${date}T${time}`);
  if (Number.isNaN(d.getTime())) throw new Error('Ugyldig dato eller tid');
  return d.toISOString();
}

// An end time at or before the start time means the event runs past midnight.
export function endIso(date, start, end) {
  if (!end) return null;
  const d = new Date(`${date}T${end}`);
  if (Number.isNaN(d.getTime())) throw new Error('Ugyldig sluttid');
  if (end <= start) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

export function splitIso(iso) {
  const d = new Date(iso);
  return { date: dateKey(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

// Every day shown for a month, Monday first, padded to whole weeks.
export function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = Math.ceil((lead + daysInMonth) / 7) * 7;
  return Array.from({ length: cells }, (_, i) => new Date(year, month, 1 - lead + i));
}

export function formatDay(iso) {
  return new Date(iso).toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });
}

export function formatTime(iso) {
  return new Date(iso).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
}

export function formatRange(startIso, endsIso) {
  return endsIso ? `${formatTime(startIso)} til ${formatTime(endsIso)}` : formatTime(startIso);
}

export function formatMonth(d) {
  return d.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' });
}

export function dateParts(iso) {
  const d = new Date(iso);
  return {
    weekday: d.toLocaleDateString(LOCALE, { weekday: 'short' }),
    day: String(d.getDate()),
    month: d.toLocaleDateString(LOCALE, { month: 'short' }),
  };
}

// "Søren" -> "soeren@<domain>". Throws when nothing usable is left.
export function nameToEmail(name, domain) {
  const local = String(name)
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replaceAll('æ', 'ae')
    .replaceAll('ø', 'oe')
    .replaceAll('å', 'aa')
    .normalize('NFD')
    .replace(/[^a-z0-9]/g, '');
  if (!local) throw new Error('Skriv dit navn');
  return `${local}@${domain}`;
}
