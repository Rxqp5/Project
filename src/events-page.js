// Events page: every Pokémon GO event, in the order it starts around the world, with
// coordinates for where to play (the city for in-person events, a raid spot per country
// for worldwide ones).

import {
  buildEvents, upcoming, countryList, statusAt, typeLabel, flag, mapLink, fmtCoords,
} from './events.js';
import { RAID_SPOTS } from './places.js';

const STATE_KEY = 'events-filter';
const GEO_KEY = 'events-geocoded';

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function loadJson(key, fallback) {
  try {
    return JSON.parse(storage()?.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    // Not saved (private browsing); it still works for this visit.
  }
}

const state = { country: '', hideLong: true, ...loadJson(STATE_KEY, {}) };
const geocoded = loadJson(GEO_KEY, {});
const geocoding = new Set();

// Places we don't have coordinates for, looked up once on OpenStreetMap and remembered.
async function geocode(name, rerender) {
  if (geocoding.has(name) || geocoded[name] !== undefined) return;
  geocoding.add(name);
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(name)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'Accept-Language': 'en' } });
    const [hit] = await res.json();
    geocoded[name] = hit ? {
      city: hit.name || name,
      country: hit.address?.country || '',
      code: hit.address?.country_code?.toUpperCase() || null,
      lat: Number(hit.lat), lon: Number(hit.lon), tz: null,
    } : null;
    saveJson(GEO_KEY, geocoded);
    rerender();
  } catch {
    // Offline: try again next time.
  } finally {
    geocoding.delete(name);
  }
}

const fmt = (date, tz, opts = {}) => new Intl.DateTimeFormat(undefined, {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz || undefined, ...opts,
}).format(date);
const fmtYour = (date) => fmt(date);

function fmtLocalRange(row) {
  if (!row.tz) return `${fmtYour(row.start)} – ${fmtYour(row.end)} <span class="hint">your time</span>`;
  const sameDay = fmt(row.start, row.tz, { hour: undefined, minute: undefined }) === fmt(row.end, row.tz, { hour: undefined, minute: undefined });
  const end = sameDay ? fmt(row.end, row.tz, { weekday: undefined, day: undefined, month: undefined }) : fmt(row.end, row.tz);
  return `${fmt(row.start, row.tz)} – ${end}`;
}

function relative(date, now) {
  const mins = Math.round((date - now) / 60000);
  const abs = Math.abs(mins);
  const text = abs < 60 ? `${abs} min` : abs < 48 * 60 ? `${Math.round(abs / 60)} h` : `${Math.round(abs / 1440)} days`;
  return mins >= 0 ? `in ${text}` : `${text} ago`;
}

function coordsHtml(esc, row) {
  if (row.lat == null) return '<span class="hint">coordinates not known yet</span>';
  const c = fmtCoords(row.lat, row.lon);
  return `<span class="coords"><code>${c}</code>
    <button type="button" class="copy" data-copy="${c}" title="Copy coordinates" aria-label="Copy coordinates ${c}">⧉</button>
    <a href="${esc(mapLink(row.lat, row.lon))}" target="_blank" rel="noopener">Map</a></span>`;
}

const placeLabel = (esc, row) => `${flag(row.code)} <strong>${esc(row.spot)}</strong>${row.spot !== row.city ? `, ${esc(row.city)}` : ''}
  <span class="hint">${esc(row.country)}</span>`;

function statusChip(ev, now) {
  const live = ev.rows.filter((r) => statusAt(r, now) === 'live').length;
  if (live) {
    return ev.rows.length > 1
      ? `<span class="status status-now">Live now in ${live} of ${ev.rows.length} places</span>`
      : '<span class="status status-now">Live now</span>';
  }
  return `<span class="status status-soon">Starts ${relative(ev.start, now)}</span>`;
}

function eventCard(esc, ev, now, country) {
  let where;
  if (ev.scope === 'in-person') {
    const r = ev.rows[0];
    where = `<p class="ev-line">📍 In person: ${placeLabel(esc, r)}</p>
      <p class="ev-line">${coordsHtml(esc, r)}</p>
      <p class="ev-line">${fmtLocalRange(r)}${r.tz ? ` <span class="hint">local · ${fmtYour(r.start)} your time</span>` : ''}</p>`;
  } else if (ev.scope === 'simultaneous') {
    where = `<p class="ev-line">🌐 Same moment worldwide: <strong>${fmtYour(ev.start)}</strong> <span class="hint">your time</span></p>
      ${country ? ev.rows.map((r) => `<p class="ev-line">${placeLabel(esc, r)} · ${fmt(r.start, r.tz)} local</p>
      <p class="ev-line">${coordsHtml(esc, r)}</p>`).join('') : ''}`;
  } else if (country) {
    where = ev.rows.map((r) => `<div class="ev-place">
      <p class="ev-line">${placeLabel(esc, r)}</p>
      <p class="ev-line">${fmtLocalRange(r)} <span class="hint">local · starts ${fmtYour(r.start)} your time</span></p>
      <p class="ev-line">${coordsHtml(esc, r)}</p></div>`).join('');
  } else {
    const first = ev.rows[0];
    const last = ev.rows[ev.rows.length - 1];
    where = `<p class="ev-line">🌏 Worldwide at local time: ${fmtLocalRange(first)} local, in every country</p>
      <p class="ev-line"><span class="ev-tag">First</span> ${placeLabel(esc, first)} · ${fmtYour(first.start)} <span class="hint">your time</span></p>
      <p class="ev-line"><span class="ev-tag">Last</span> ${placeLabel(esc, last)} · ${fmtYour(last.start)} <span class="hint">your time</span></p>`;
  }
  return `<article class="panel ev">
    <div class="ev-head">
      <span class="tier tier-special">${esc(typeLabel(ev.type))}</span> ${statusChip(ev, now)}
    </div>
    <h2><a href="#/events/${encodeURIComponent(ev.id)}">${esc(ev.name)}</a></h2>
    ${where}
    <p class="ev-line"><a href="#/events/${encodeURIComponent(ev.id)}">${ev.scope === 'in-person' ? 'Details and map' : 'Every country, in order'} →</a></p>
  </article>`;
}

function bindCommon(app) {
  app.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(b.dataset.copy);
      b.textContent = '✓';
    } catch {
      b.textContent = '✗';
    }
    setTimeout(() => { b.textContent = '⧉'; }, 1500);
  }));
}

function renderList(app, ctx, list) {
  const { esc } = ctx;
  const now = new Date();
  const items = upcoming(list, { now, country: state.country || null, hideLong: state.hideLong });
  const countries = countryList();
  const chosen = countries.find((c) => c.code === state.country);
  const spots = chosen ? RAID_SPOTS.filter((s) => s.code === chosen.code) : [];
  const hiddenLong = state.hideLong ? upcoming(list, { now, country: state.country || null, hideLong: false }).length - items.length : 0;
  document.title = `Events${chosen ? ` in ${chosen.country}` : ' worldwide'} · Raid Boss Guide`;
  app.innerHTML = `
    <section class="rotation-head">
      <h1>Events ${chosen ? `in ${flag(chosen.code)} ${esc(chosen.country)}` : 'worldwide'}</h1>
      <p class="hint">${chosen
    ? `In the order they start in ${esc(chosen.country)}, with where to raid.`
    : 'In the order they start somewhere in the world. Most events run at local time, so they start first in Kiribati (UTC+14) and last in American Samoa (UTC−11), about a day later. In-person events show the city they\'re in.'}
      From <a href="https://leekduck.com/events/" target="_blank" rel="noopener">LeekDuck</a>,
      ${ctx.schedule.live ? 'checked just now' : 'offline copy'}.</p>
    </section>
    <section class="panel settings">
      <label>Country
        <select id="ev-country">
          <option value="">All countries (earliest first)</option>
          ${countries.map((c) => `<option value="${c.code}" ${c.code === state.country ? 'selected' : ''}>${flag(c.code)} ${esc(c.country)}</option>`).join('')}
        </select>
      </label>
      <label class="check"><input type="checkbox" id="ev-long" ${state.hideLong ? 'checked' : ''}> Hide seasons, GO Pass, Battle League and long research</label>
    </section>
    ${spots.length ? `<section class="panel note">
      <h2>Where to raid in ${esc(chosen.country)}</h2>
      ${spots.map((s) => `<p class="ev-line">${placeLabel(esc, s)}</p><p class="ev-line">${coordsHtml(esc, s)}</p>`).join('')}
      <p class="hint">Busy areas with lots of gyms close together, where raid groups tend to meet.
      ${spots.length > 1 ? `${esc(chosen.country)} spans several time zones, so times are given for each spot.` : ''}</p>
    </section>` : ''}
    ${items.length ? `<div class="ev-list">${items.map((ev) => eventCard(esc, ev, now, state.country)).join('')}</div>`
    : '<p class="empty">No upcoming events announced.</p>'}
    ${hiddenLong ? `<p class="hint">${hiddenLong} long-running event${hiddenLong > 1 ? 's' : ''} hidden.</p>` : ''}`;
  app.querySelector('#ev-country').addEventListener('change', (e) => {
    state.country = e.target.value;
    saveJson(STATE_KEY, state);
    ctx.rerender();
  });
  app.querySelector('#ev-long').addEventListener('change', (e) => {
    state.hideLong = e.target.checked;
    saveJson(STATE_KEY, state);
    ctx.rerender();
  });
  bindCommon(app);
}

function osmEmbed(lat, lon) {
  const d = 0.05;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${lon - d},${lat - d},${lon + d},${lat + d}&layer=mapnik&marker=${lat},${lon}`;
}

function renderDetail(app, ctx, list, id) {
  const { esc } = ctx;
  const ev = list.find((e) => e.id === id);
  if (!ev) {
    app.innerHTML = '<a class="back" href="#/events">← All events</a><p class="empty">This event isn\'t in the calendar any more.</p>';
    return;
  }
  document.title = `${ev.name} · Raid Boss Guide`;
  const now = new Date();
  const first = ev.places[0];
  const explain = {
    local: `Runs at ${fmt(first.start, first.tz, { weekday: undefined, day: undefined, month: undefined })}–${fmt(first.end, first.tz, { weekday: undefined, day: undefined, month: undefined })} local time in every country, so it rolls around the world from east to west.
      Below, every country in the order it starts there, with a raid spot and its coordinates.`,
    simultaneous: 'Starts at the same moment everywhere. Below, what time that is in each country.',
    'in-person': 'An in-person event: you need a ticket and to be there.',
  }[ev.scope];
  // Rows starting at the same moment are numbered together.
  let rank = 0;
  let prev = null;
  const rows = ev.places.map((r) => {
    if (prev === null || r.start.getTime() !== prev) rank++;
    prev = r.start.getTime();
    const st = statusAt(r, now);
    return `<tr class="${st === 'live' ? 'ev-live' : st === 'ended' ? 'ev-ended' : ''}">
      <td>${rank}</td>
      <td>${placeLabel(esc, r)}</td>
      <td>${coordsHtml(esc, r)}</td>
      <td>${r.tz ? fmtLocalRange(r) : '—'}</td>
      <td>${fmtYour(r.start)}</td>
      <td>${st === 'live' ? '<span class="status status-now">Live</span>' : st === 'ended' ? '<span class="hint">Ended</span>' : `<span class="hint">${relative(r.start, now)}</span>`}</td>
    </tr>`;
  }).join('');
  app.innerHTML = `
    <a class="back" href="#/events">← All events</a>
    <section class="panel">
      ${ev.image ? `<img class="ev-image" src="${esc(ev.image)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
      <div class="ev-head"><span class="tier tier-special">${esc(typeLabel(ev.type))}</span></div>
      <h1 class="ev-title">${esc(ev.name)}</h1>
      <p>${explain}</p>
      ${ev.link ? `<p><a href="${esc(ev.link)}" target="_blank" rel="noopener">Full details on LeekDuck →</a></p>` : ''}
    </section>
    ${ev.scope === 'in-person' && first.lat != null ? `<section class="panel">
      <h2>📍 ${esc(first.city)}${first.country ? `, ${esc(first.country)}` : ''}</h2>
      <p>${coordsHtml(esc, first)}</p>
      <p>${fmtLocalRange(first)}${first.tz ? ' local' : ''} · starts ${fmtYour(first.start)} your time</p>
      <iframe class="ev-map" title="Map of ${esc(first.city)}" loading="lazy" src="${esc(osmEmbed(first.lat, first.lon))}"></iframe>
      <p class="hint">City centre coordinates. The exact venue is on the event's ticket page.</p>
    </section>` : ''}
    ${ev.scope !== 'in-person' ? `<section class="panel">
      <h2>${ev.scope === 'local' ? 'Every country, in the order it starts' : 'Local time in every country'}</h2>
      <div class="table-wrap"><table class="counters ev-table">
        <thead><tr><th>#</th><th>Where</th><th>Coordinates</th><th>Local time</th><th>Your time</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="hint">Raid spots are busy areas with lots of gyms close together in each country's biggest city for Pokémon GO.
      Large countries have one per main time zone.</p>
    </section>` : ''}`;
  bindCommon(app);
}

export function renderEvents(app, ctx, id) {
  if (!ctx.schedule) {
    app.innerHTML = '<p class="loading">Loading events…</p>';
    return;
  }
  const list = buildEvents(ctx.schedule.events, { geocoded });
  for (const ev of list) {
    if (ev.scope === 'in-person' && ev.places[0].lat == null && ev.placeName) geocode(ev.placeName, ctx.rerender);
  }
  if (id) renderDetail(app, ctx, list, decodeURIComponent(id));
  else renderList(app, ctx, list);
}
