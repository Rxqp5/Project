// Turns LeekDuck's event calendar (via ScrapedDuck) into a day-by-day raid rotation.
// Pure functions, shared by the app and the tests.

export const SCHEDULE_URLS = {
  events: 'https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/events.json',
  lineup: 'https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/raids.json',
};

const REGIONAL = { alolan: 'alola', galarian: 'galarian', hisuian: 'hisuian', paldean: 'paldea' };

const normalize = (s) => s.toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\bformes?\b/g, '').replace(/[^a-z0-9()]+/g, ' ').replace(/\s*\(\s*/g, ' (').replace(/\s*\)/g, ')')
  .trim();

// Maps LeekDuck names ("Alolan Raichu", "Shadow Gastly", "Giratina (Origin Forme)") to our keys.
export function nameIndex(data) {
  const exact = new Map();
  const species = new Map();
  for (const [key, p] of Object.entries(data.pokemon)) {
    const n = normalize(p.name);
    if (!exact.has(n)) exact.set(n, key);
    const bare = n.replace(/ \(.*\)$/, '');
    if (!p.mega && !p.gmax && !species.has(bare)) species.set(bare, key);
  }
  return (name) => {
    let n = normalize(name).replace(/^(shadow|dynamax) /, '');
    const regional = /^(alolan|galarian|hisuian|paldean) (.+)$/.exec(n);
    if (regional) n = `${regional[2]} (${REGIONAL[regional[1]]})`;
    return exact.get(n) || species.get(n.replace(/ \(.*\)$/, '')) || null;
  };
}

// Which of our tiers an event's boss belongs to, preferring tiers it's actually been in.
function pickTier(data, key, text) {
  const t = text.toLowerCase();
  const p = data.pokemon[key];
  const legendary = Boolean(p.legendary);
  let candidates;
  if (/super mega/.test(t)) candidates = legendary ? ['super_mega_5', 'super_mega_4'] : ['super_mega_4', 'super_mega_5'];
  else if (/shadow/.test(t)) candidates = ['shadow_5', 'shadow_3', 'shadow_1'];
  else if (/max|dynamax|gigantamax/.test(t)) candidates = p.gmax ? ['max_6'] : ['max_5', 'max_4', 'max_3', 'max_2', 'max_1'];
  else if (p.mega === 'primal') candidates = ['primal'];
  else if (p.mega) candidates = legendary ? ['mega_legendary', 'mega'] : ['mega', 'mega_legendary'];
  else if (/elite/.test(t)) candidates = ['elite'];
  else if (/1-star/.test(t)) candidates = ['1'];
  else if (/3-star/.test(t)) candidates = ['3'];
  else candidates = ['5', 'elite', '3', '1'];
  const known = data.raids.filter((r) => r.key === key);
  return candidates.find((c) => known.some((r) => r.tier === c)) || candidates[0];
}

const LINEUP_TIERS = { '1-Star Raids': '1', '3-Star Raids': '3', '5-Star Raids': '5', 'Mega Raids': 'mega' };

const parseDate = (s) => (s ? new Date(s) : null); // dates without "Z" are local time, as in the game

// Events become schedule items. A raid-battles event yields one item per boss; Raid Hours,
// Raid Days and Max Mondays are "special" items with their own times.
export function scheduleItems(events, data) {
  const resolve = nameIndex(data);
  const items = [];
  for (const e of events) {
    const start = parseDate(e.start);
    const end = parseDate(e.end);
    if (!start || !end) continue;
    const bosses = e.extraData?.raidbattles?.bosses;
    if (e.eventType === 'raid-battles' && bosses?.length) {
      for (const b of bosses) {
        const key = resolve(b.name);
        const tier = key ? pickTier(data, key, e.name) : null;
        items.push({ kind: 'boss', key, tier, name: b.name, title: e.name, link: e.link, start, end, shiny: b.canBeShiny });
      }
    } else if (/raid|max/.test(e.eventType)) {
      // "Giratina (Altered Forme) Raid Hour", "Dynamax Machop during Max Monday"
      const subject = e.name.replace(/ (Raid Hour|Super Mega Raid Day|Raid Day)$/, '').replace(/ during Max Monday$/, '');
      const key = /,| and /.test(subject) ? null : resolve(subject);
      const tier = key ? pickTier(data, key, e.name) : null;
      items.push({ kind: 'special', type: e.eventType, key, tier, name: subject, title: e.name, link: e.link, start, end });
    }
  }
  return items.sort((a, b) => a.start - b.start);
}

// Bosses in LeekDuck's current lineup (1★/3★ and others without announced dates).
export function lineupItems(lineup, data) {
  const resolve = nameIndex(data);
  return lineup.map((r) => {
    const key = resolve(r.name);
    const shadow = /^shadow /i.test(r.name);
    const base = LINEUP_TIERS[r.tier];
    const tier = key && base ? (shadow ? `shadow_${base}` : base) : null;
    return { kind: 'lineup', key, tier, name: r.name, shiny: r.canBeShiny };
  }).filter((r) => r.key && r.tier);
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// Day-by-day view from today. Each item is flagged `first` on the first day it's listed,
// which is where the app shows its full start and end dates.
export function rotationDays(items, now = new Date(), maxDays = 21) {
  const today = startOfDay(now);
  const active = items.filter((i) => i.end > now);
  const lastEnd = Math.max(...active.map((i) => i.end.getTime()));
  const days = [];
  const seen = new Set();
  // Step by calendar day (not 24h) so daylight-saving changes don't shift the days.
  for (let n = 0; n < maxDays; n++) {
    const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() + n);
    const dayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + n + 1);
    if (n > 0 && dayStart.getTime() >= lastEnd) break;
    const dayItems = active
      .filter((i) => i.start < dayEnd && i.end > dayStart && i.end > now)
      .map((i) => {
        const first = !seen.has(i);
        seen.add(i);
        return { ...i, first, startsToday: i.start >= dayStart, endsToday: i.end <= dayEnd };
      });
    days.push({ date: dayStart, items: dayItems });
  }
  return days;
}
