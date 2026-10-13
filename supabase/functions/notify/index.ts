// Sends Rimbak's notifications: a new event to everyone but its creator, a
// reminder 24 hours before an event starts, and each answer to the person who
// made the event (unless they have turned that off).
//
// Deployed as the Supabase Edge Function "notify" with JWT verification on;
// the database calls it (see post_notify in supabase/schema.sql).
// It takes no input: it works out from the tables what is due and marks each
// event as handled before sending, so extra calls never send anything twice.
// Secrets (Edge Functions, Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// VAPID_SUBJECT. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const REQUIRED = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'];
const VERB: Record<string, string> = { joining: 'kommer', late: 'bliver forsinket', not_joining: 'kommer ikke' };

const when = (iso: string) =>
  new Intl.DateTimeFormat('da-DK', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Copenhagen',
  }).format(new Date(iso));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async () => {
  const missing = REQUIRED.filter((name) => !Deno.env.get(name));
  if (missing.length) return json({ error: 'missing settings', missing }, 500);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT')!,
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!,
  );

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const soonIso = new Date(now + DAY).toISOString();
  const result = { announced: 0, reminded: 0, answers: 0, sent: 0, removed: 0, failed: 0 };

  try {
    // Claim the new events. Older unannounced ones are left alone, so a long
    // outage does not end in a burst of stale news.
    const fresh = await db.from('events')
      .update({ announced_at: nowIso })
      .is('announced_at', null)
      .gt('created_at', new Date(now - HOUR).toISOString())
      .select('id, title, location, starts_at, created_by');
    if (fresh.error) throw fresh.error;

    // An event made less than a day ahead is its own reminder.
    const near = fresh.data.filter((e) => e.starts_at <= soonIso).map((e) => e.id);
    if (near.length) {
      const marked = await db.from('events').update({ reminded_at: nowIso }).in('id', near);
      if (marked.error) throw marked.error;
    }

    const due = await db.from('events')
      .update({ reminded_at: nowIso })
      .is('reminded_at', null)
      .gt('starts_at', nowIso)
      .lte('starts_at', soonIso)
      .select('id, title, location, starts_at');
    if (due.error) throw due.error;

    // Take the waiting answers off the queue. Only the latest per person and
    // event is news, and nothing older than an hour.
    const taken = await db.from('response_notices')
      .delete()
      .gt('id', 0)
      .select('id, event_id, user_id, status, note, created_at');
    if (taken.error) throw taken.error;
    const latest = new Map<string, typeof taken.data[number]>();
    for (const n of taken.data.sort((a, b) => a.id - b.id)) {
      if (new Date(n.created_at).getTime() > now - HOUR) latest.set(`${n.event_id}:${n.user_id}`, n);
    }
    const answers = [...latest.values()];

    result.announced = fresh.data.length;
    result.reminded = due.data.length;
    result.answers = answers.length;
    if (!fresh.data.length && !due.data.length && !answers.length) return json(result);

    const [subs, profiles, answered] = await Promise.all([
      db.from('push_subscriptions').select('endpoint, user_id, p256dh, auth'),
      db.from('profiles').select('id, name, notify_responses'),
      db.from('events').select('id, title, starts_at, created_by').in('id', answers.map((a) => a.event_id)),
    ]);
    if (subs.error) throw subs.error;
    if (profiles.error) throw profiles.error;
    if (answered.error) throw answered.error;
    const names = new Map(profiles.data.map((p) => [p.id, p.name]));
    const wants = new Set(profiles.data.filter((p) => p.notify_responses).map((p) => p.id));
    const events = new Map(answered.data.map((e) => [e.id, e]));

    const jobs: Promise<void>[] = [];
    const push = (sub: typeof subs.data[number], payload: Record<string, string>) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: 12 * 60 * 60 },
      ).then(() => {
        result.sent += 1;
      }).catch(async (err: { statusCode?: number }) => {
        // The push service says this device is gone: forget it.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await db.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
          result.removed += 1;
        } else {
          console.error('push failed', err.statusCode ?? err);
          result.failed += 1;
        }
      });

    for (const ev of fresh.data) {
      const by = names.get(ev.created_by);
      const payload = {
        title: `Ny begivenhed: ${ev.title}`,
        body: `${when(ev.starts_at)}${by ? `. Oprettet af ${by}.` : ''}`,
        tag: ev.id,
      };
      for (const sub of subs.data) {
        if (sub.user_id !== ev.created_by) jobs.push(push(sub, payload));
      }
    }

    for (const ev of due.data) {
      const payload = {
        title: `Påmindelse: ${ev.title}`,
        body: `${when(ev.starts_at)}${ev.location ? `, ${ev.location}` : ''}`,
        tag: ev.id,
      };
      for (const sub of subs.data) jobs.push(push(sub, payload));
    }

    for (const a of answers) {
      const ev = events.get(a.event_id);
      const who = names.get(a.user_id);
      if (!ev || !who) continue;
      const payload = {
        title: `${who} ${VERB[a.status] ?? 'har svaret'}`,
        body: `${ev.title}, ${when(ev.starts_at)}${a.note ? `\n${a.note}` : ''}`,
        // One notification per person and event: a changed answer replaces the old one.
        tag: `${a.event_id}:${a.user_id}`,
      };
      // Only the person who made the event hears about the answers to it.
      if (ev.created_by === a.user_id || !wants.has(ev.created_by)) continue;
      for (const sub of subs.data) {
        if (sub.user_id === ev.created_by) jobs.push(push(sub, payload));
      }
    }

    await Promise.all(jobs);
    return json(result);
  } catch (err) {
    console.error(err);
    return json({ error: 'failed', ...result }, 500);
  }
});
