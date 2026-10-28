// Calendar files (.ics) for raid reminders. Used by the data build (the subscribable calendar)
// and by the app ("add this one to my calendar"). Pure functions.
//
// Pokémon GO events run at the same local time everywhere, so times without a "Z" are written as
// "floating" times, which calendars show at that clock time wherever the phone is.

const pad = (n) => String(n).padStart(2, '0');

// "2026-10-28T18:00:00.000" → "20261028T180000" (floating); "...Z" → UTC with a trailing Z.
export function icsTime(value) {
  if (value instanceof Date) {
    return `${value.getFullYear()}${pad(value.getMonth() + 1)}${pad(value.getDate())}T${pad(value.getHours())}${pad(value.getMinutes())}00`;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) throw new Error(`Bad date: ${value}`);
  return `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}00${/Z$/.test(value) ? 'Z' : ''}`;
}

const escapeText = (s) => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`);

// Lines longer than 75 bytes must be folded (continued on the next line after a space).
function fold(line) {
  const out = [];
  let rest = line;
  while (new TextEncoder().encode(rest).length > 75) {
    let cut = 75;
    while (new TextEncoder().encode(rest.slice(0, cut)).length > 75) cut--;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

// events: [{ uid, title, start, end, description?, url?, alarmMinutes? | alarms?: [minutes before] }]
export function toIcs(events, { name = 'Raid Boss Guide', stamp = new Date() } = {}) {
  const dtstamp = `${stamp.getUTCFullYear()}${pad(stamp.getUTCMonth() + 1)}${pad(stamp.getUTCDate())}T${pad(stamp.getUTCHours())}${pad(stamp.getUTCMinutes())}00Z`;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Raid Boss Guide//EN', 'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeText(name)}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT12H', 'X-PUBLISHED-TTL:PT12H',
  ];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}@raid-boss-guide`, `DTSTAMP:${dtstamp}`,
      `DTSTART:${icsTime(e.start)}`, `DTEND:${icsTime(e.end)}`, `SUMMARY:${escapeText(e.title)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    for (const minutes of e.alarms || (e.alarmMinutes != null ? [e.alarmMinutes] : [])) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(e.title)}`,
        `TRIGGER:-PT${minutes}M`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

// Short events (Raid Hour, Raid Day, Max Monday) get an alert 30 minutes before; boss rotations,
// which last days, get one when they start.
const SPECIAL = { 'raid-hour': 'Raid Hour', 'raid-day': 'Raid Day', 'max-mondays': 'Max Monday' };

// LeekDuck events (as ScrapedDuck publishes them) → calendar events for raids.
export function raidCalendarEvents(events) {
  const out = [];
  for (const e of events) {
    if (!e.start || !e.end) continue;
    if (SPECIAL[e.eventType]) {
      out.push({ uid: e.eventID, title: e.name, start: e.start, end: e.end, url: e.link, alarmMinutes: 30 });
    } else if (e.eventType === 'raid-battles') {
      out.push({ uid: e.eventID, title: e.name, start: e.start, end: e.end, url: e.link, alarmMinutes: 0 });
    }
  }
  return out;
}
