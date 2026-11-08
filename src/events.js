// Works out when each Pokémon GO event starts in each country, and where it happens.
// Pure functions, shared by the app and the tests.
//
// LeekDuck (via ScrapedDuck) gives two kinds of times:
// - with a "Z" (e.g. "2026-11-10T18:00:00.000Z"): one fixed moment. In-person events (GO Fest,
//   GO Tour, Wild Areas, Night Out) and GO Battle League seasons use these.
// - without a "Z" (e.g. "2026-11-21T14:00:00.000"): local time, wherever you are. Community
//   Days, Raid Hours and most worldwide events use these, so they start first in the Line
//   Islands of Kiribati (UTC+14) and last in American Samoa (UTC−11), about 25 hours later.

import { RAID_SPOTS, EVENT_CITIES } from './places.js';

// Event types that are always worldwide, even when their times are fixed.
const ALWAYS_WORLDWIDE = new Set(['go-battle-league', 'season', 'go-pass']);
// Long background events, hidden by default in the list.
export const LONG_TYPES = new Set(['season', 'go-pass', 'go-battle-league', 'research']);

export const TYPE_LABELS = {
  'community-day': 'Community Day',
  'raid-hour': 'Raid Hour',
  'raid-day': 'Raid Day',
  'raid-battles': 'Raids',
  'raid-weekend': 'Raid Weekend',
  'max-mondays': 'Max Monday',
  'max-battles': 'Max Battles',
  'pokemon-spotlight-hour': 'Spotlight Hour',
  'go-battle-league': 'GO Battle League',
  'pokemon-go-fest': 'GO Fest',
  'pokemon-go-tour': 'GO Tour',
  'safari-zone': 'Safari Zone',
  'city-safari': 'City Safari',
  'wild-area': 'Wild Area',
  'timed-research': 'Timed Research',
  'special-research': 'Special Research',
  research: 'Research',
  'research-day': 'Research Day',
  'go-pass': 'GO Pass',
  season: 'Season',
  event: 'Event',
};

export const typeLabel = (t) => TYPE_LABELS[t] || t.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Minutes a time zone is ahead of UTC at a given moment (handles daylight saving).
export function tzOffsetMinutes(date, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

// A local wall-clock time ("2026-11-21T14:00:00.000") in a time zone, as a real moment.
export function zonedToUtc(wall, tz) {
  const m = /^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d)(?::(\d\d))?)?/.exec(wall);
  if (!m) return null;
  const guess = Date.UTC(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  const first = guess - tzOffsetMinutes(new Date(guess), tz) * 60000;
  const second = guess - tzOffsetMinutes(new Date(first), tz) * 60000;
  return new Date(second);
}

const isFixed = (s) => /(Z|[+-]\d\d:?\d\d)$/.test(s);

// The city an event's name refers to, if it's one we know.
export function findCity(name) {
  const n = fold(name);
  let best = null;
  for (const c of EVENT_CITIES) {
    for (const alias of c.names) {
      const re = new RegExp(`(^|[^a-z])${escapeRe(fold(alias))}($|[^a-z])`);
      // Prefer the longest match ("New Taipei" over "Taipei", "Jersey City" over "New York").
      if (re.test(n) && (!best || alias.length > best.len)) best = { city: c, len: alias.length };
    }
  }
  return best?.city || null;
}

// For names we don't know: the place part of "...: Sendai • Tohoku" or "... - London 2026".
export function guessPlaceName(name) {
  const tail = name.split(/\s[-–—]\s|:\s/).pop();
  const place = tail.split('•')[0].replace(/\b(19|20)\d\d\b/g, '').replace(/\s+/g, ' ').trim();
  return place && place !== name.trim() ? place : null;
}

const isGlobal = (name) => /\bglobal\b|\bworldwide\b/i.test(name);

// Where an event happens: 'local' (worldwide, at local time), 'simultaneous' (worldwide, one
// moment) or 'in-person' (one city).
export function classify(e) {
  const fixed = isFixed(e.start);
  if (ALWAYS_WORLDWIDE.has(e.eventType) || isGlobal(e.name)) return { scope: fixed ? 'simultaneous' : 'local' };
  const city = findCity(e.name);
  if (city) return { scope: 'in-person', city };
  const guess = guessPlaceName(e.name);
  // A fixed time with a place in the name: in person somewhere we'd have to look up.
  if (fixed && guess) return { scope: 'in-person', city: null, placeName: guess };
  return { scope: fixed ? 'simultaneous' : 'local' };
}

const slug = (s) => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const flag = (code) => (code ? String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '🌐');
export { flag };

// One row per place: when the event starts and ends there.
// Times without a "Z" are read in the place's time zone (or the device's, if it has none).
function placeTimes(e, spot) {
  const at = (s) => (isFixed(s) || !spot.tz ? new Date(s) : zonedToUtc(s, spot.tz));
  return { ...spot, start: at(e.start), end: at(e.end) };
}

// Every event, with a row per place in the order it starts there.
export function buildEvents(events, { geocoded = {} } = {}) {
  const out = [];
  const ids = new Set();
  for (const e of events) {
    if (!e.start || !e.end) continue;
    const c = classify(e);
    let places;
    if (c.scope === 'in-person') {
      const city = c.city || geocoded[c.placeName] || null;
      const spot = city
        ? { code: city.code, country: city.country, spot: city.city, city: city.city, lat: city.lat, lon: city.lon, tz: city.tz }
        : { code: null, country: 'Location to be confirmed', spot: c.placeName, city: c.placeName, lat: null, lon: null, tz: null };
      // A city event in local time (no "Z") is local to that city.
      places = [placeTimes(e, spot)];
    } else {
      places = RAID_SPOTS.map((s) => placeTimes(e, s));
    }
    places = places.filter((p) => p.start && p.end && !Number.isNaN(p.start.getTime()));
    if (!places.length) continue;
    places.sort((a, b) => a.start - b.start || b.lon - a.lon || a.country.localeCompare(b.country));
    let id = e.eventID || slug(e.name);
    while (ids.has(id)) id += '-2';
    ids.add(id);
    out.push({
      id, name: e.name, type: e.eventType, link: e.link, image: e.image,
      scope: c.scope, placeName: c.placeName,
      places,
      firstStart: places[0].start,
      lastStart: places[places.length - 1].start,
      lastEnd: new Date(Math.max(...places.map((p) => p.end.getTime()))),
    });
  }
  return out.sort((a, b) => a.firstStart - b.firstStart || a.lastEnd - b.lastEnd);
}

// The countries in the picker, in alphabetical order.
export function countryList() {
  const seen = new Map();
  for (const s of RAID_SPOTS) if (!seen.has(s.code)) seen.set(s.code, s.country);
  return [...seen].map(([code, country]) => ({ code, country })).sort((a, b) => a.country.localeCompare(b.country));
}

export function statusAt(row, now) {
  if (now >= row.end) return 'ended';
  if (now >= row.start) return 'live';
  return 'upcoming';
}

// The events still to come or running now, in the order they start.
// With a country, only that country's rows (and in-person events there), ordered by its start.
export function upcoming(list, { now = new Date(), country = null, hideLong = true } = {}) {
  return list
    .filter((ev) => !(hideLong && LONG_TYPES.has(ev.type)))
    .map((ev) => {
      const rows = country ? ev.places.filter((p) => p.code === country) : ev.places;
      const live = rows.filter((p) => p.end > now);
      if (!live.length) return null;
      return { ...ev, rows: live, start: live[0].start, end: new Date(Math.max(...live.map((p) => p.end.getTime()))) };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

export const mapLink = (lat, lon) => `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
export const fmtCoords = (lat, lon) => `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
