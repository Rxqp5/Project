import {
  TIERS, SHIELD_ATK, SHIELD_DEF, matchups, boostedWeather, bossStats, catchCP, rankCounters, pickParty,
  budgetFilter, canBreakShields, trainersNeeded, bestMovesetsOverall,
} from './calc.js';

const app = document.getElementById('app');
const TIER_ORDER = ['1', '2', '3', '4', '5', 'elite', 'shadow_1', 'shadow_3', 'shadow_5',
  'mega', 'mega_legendary', 'primal', 'super_mega_4', 'super_mega_5'];
const TIER_SHORT = {
  1: '1★', 2: '2★', 3: '3★', 4: '4★', 5: '5★', elite: 'Elite',
  shadow_1: 'Shadow 1★', shadow_3: 'Shadow 3★', shadow_5: 'Shadow 5★',
  mega: 'Mega', mega_legendary: 'Mega Legendary', primal: 'Primal',
  super_mega_4: 'Super Mega 4★', super_mega_5: 'Super Mega 5★',
};
const STATUS_ORDER = { current: 0, upcoming: 1, past: 2, future: 3 };
const COUNTERS_SHOWN = 20;

let data;
const listState = { tier: 'now', query: '' };
const settings = loadSettings();
const counterCache = new Map();

function loadSettings() {
  const defaults = { level: 40, weather: '', megas: true, shadows: true, legendaries: true, elite: true };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem('settings') || '{}') };
  } catch {
    return defaults;
  }
}

function saveSettings() {
  try {
    localStorage.setItem('settings', JSON.stringify(settings));
  } catch {
    // Storage can be unavailable (private browsing); settings just won't persist.
  }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sprite = (dex) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${dex}.png`;
const typeBadge = (t) => `<span class="type type-${t.toLowerCase()}">${t}</span>`;
const typeBadges = (types) => types.map(typeBadge).join('');
const moveName = (id) => data.moves[id].name;
const moveBadge = (id, elite) => {
  const m = data.moves[id];
  return `<span class="move"><span class="dot type-${m.type.toLowerCase()}"></span>${esc(m.name)}${elite ? '<sup title="Elite TM / legacy move">*</sup>' : ''}</span>`;
};
const fmtMult = (m) => `${(Math.round(m * 1000) / 1000).toString().replace(/^0\./, '.')}×`;
const fmtDate = (ms) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const bossName = (r) => (TIERS[r.tier].shadow ? `Shadow ${data.pokemon[r.key].name}` : data.pokemon[r.key].name);
const findRaid = (tier, key) => data.raids.find((r) => r.tier === tier && r.key === key);

function statusBadge(r) {
  if (r.status === 'current') return '<span class="status status-now">In raids now</span>';
  if (r.status === 'upcoming') return `<span class="status status-soon">${r.start ? `From ${fmtDate(r.start)}` : 'Coming soon'}</span>`;
  if (r.status === 'future') return '<span class="status">Not yet in raids</span>';
  return '';
}

// ---------- Boss list ----------

// Tabs: "now" = in raids or announced, "future" = could become a boss one day, else a tier.
// Every tab except "future" leaves out bosses that have never actually appeared.
const TAB_FILTERS = {
  now: (r) => r.status === 'current' || r.status === 'upcoming',
  all: (r) => r.status !== 'future',
  future: (r) => r.status === 'future',
};
const tabFilter = (tab) => TAB_FILTERS[tab] || ((r) => r.tier === tab && r.status !== 'future');

function bossList() {
  const q = listState.query.trim().toLowerCase();
  return data.raids
    .filter(tabFilter(listState.tier))
    .filter((r) => !q || bossName(r).toLowerCase().includes(q)
      || data.pokemon[r.key].types.some((t) => t.toLowerCase() === q))
    .sort((a, b) => (listState.tier === 'now' ? STATUS_ORDER[a.status] - STATUS_ORDER[b.status] : 0)
      || TIER_ORDER.indexOf(b.tier) - TIER_ORDER.indexOf(a.tier)
      || data.pokemon[a.key].dex - data.pokemon[b.key].dex
      || data.pokemon[a.key].name.localeCompare(data.pokemon[b.key].name));
}

function renderList() {
  document.title = 'Raid Boss Guide';
  const count = (tab) => data.raids.filter(tabFilter(tab)).length;
  const tabs = [['now', 'Raids now'], ['all', 'All'], ...TIER_ORDER, ['future', 'Possible future']]
    .map((t) => (Array.isArray(t) ? t : [t, TIER_SHORT[t]]))
    .map(([t, label]) => [t, label, count(t)])
    .filter(([, , n]) => n);
  app.innerHTML = `
    <section class="controls">
      <input id="search" type="search" placeholder="Search a Pokémon or type (e.g. Mewtwo, Dragon)" value="${esc(listState.query)}" autocomplete="off">
      <div class="tabs" role="tablist">
        ${tabs.map(([t, label, n]) => `<button role="tab" data-tier="${t}" aria-selected="${listState.tier === t}">${label} (${n})</button>`).join('')}
      </div>
    </section>
    <section id="grid" class="grid"></section>`;
  renderGrid();

  app.querySelector('#search').addEventListener('input', (e) => {
    listState.query = e.target.value;
    renderGrid();
  });
  app.querySelectorAll('[data-tier]').forEach((b) => b.addEventListener('click', () => {
    listState.tier = b.dataset.tier;
    app.querySelectorAll('[data-tier]').forEach((x) => x.setAttribute('aria-selected', x === b));
    renderGrid();
  }));
}

function renderGrid() {
  const bosses = bossList();
  app.querySelector('#grid').innerHTML = bosses.length
    ? bosses.map((r) => {
      const p = data.pokemon[r.key];
      return `
        <a class="card" href="#/boss/${r.tier}/${r.key}">
          <img src="${sprite(p.dex)}" alt="" loading="lazy" width="72" height="72" onerror="this.style.visibility='hidden'">
          <div class="card-body">
            <span><span class="tier tier-${r.tier}">${TIER_SHORT[r.tier]}</span> ${statusBadge(r)}</span>
            <strong>${esc(bossName(r))}</strong>
            <div>${typeBadges(p.types)}</div>
          </div>
        </a>`;
    }).join('')
    : '<p class="empty">No raid bosses match that search.</p>';
}

// ---------- Boss detail ----------

function countersFor(key, tier, bossMoves) {
  // Super Mega raids can't be won without Megas, so always rank them.
  const opts = { ...settings, bossMoves, megas: settings.megas || Boolean(TIERS[tier].superMega) };
  const cacheKey = JSON.stringify([key, tier, opts]);
  if (!counterCache.has(cacheKey)) counterCache.set(cacheKey, rankCounters(data, key, tier, opts));
  return counterCache.get(cacheKey);
}

function renderBoss(tier, key, bossMoves) {
  const p = data.pokemon[key];
  if (!p || !TIERS[tier]) {
    app.innerHTML = '<p class="empty">Raid boss not found. <a href="#/">Back to all bosses</a></p>';
    return;
  }
  const raid = findRaid(tier, key) || { key, tier, status: 'past' };
  const name = bossName(raid);
  const { superMega } = TIERS[tier];
  const shields = raid.shields || TIERS[tier].shields;
  document.title = `${name} raid guide`;
  const boss = bossStats(p, tier);
  const caught = data.pokemon[p.base] || p; // Megas are caught in their normal form
  const normalCp = catchCP(caught);
  const boostedCp = catchCP(caught, true);
  const types = matchups(p.types, data);
  const weak = types.filter((t) => t.mult > 1.001);
  const resist = types.filter((t) => t.mult < 0.999).reverse();
  const counters = countersFor(key, tier, bossMoves);
  const party = pickParty(counters, undefined, { requireMega: superMega });
  const budget = pickParty(counters, budgetFilter, { requireMega: superMega });
  const shieldBreakers = superMega ? counters.filter(canBreakShields).slice(0, 6) : [];
  const ownMovesets = bestMovesetsOverall(caught, data, { level: settings.level, elite: true }).slice(0, 5);
  const bossMovePairs = p.fast.flatMap((f) => p.charged.map((c) => [f, c]));

  app.innerHTML = `
    <a href="#/" class="back">← All raid bosses</a>
    <section class="boss-head">
      <img src="${sprite(p.dex)}" alt="" width="120" height="120" onerror="this.style.visibility='hidden'">
      <div>
        <span class="tier tier-${tier}">${TIERS[tier].label} raid</span> ${statusBadge(raid)}
        <h1>${esc(name)} <small>#${p.dex}</small></h1>
        <div>${typeBadges(p.types)}</div>
        <dl class="facts">
          <div><dt>Boss CP</dt><dd>${boss.cp.toLocaleString()}</dd></div>
          <div><dt>Boss HP</dt><dd>${boss.hp.toLocaleString()}</dd></div>
          <div><dt>Catch CP</dt><dd>${normalCp.min}–${normalCp.max}</dd></div>
          <div><dt>Weather boosted</dt><dd>${boostedCp.min}–${boostedCp.max}</dd></div>
          <div><dt>Boosted in</dt><dd>${boostedWeather(p.types, data).join(', ') || '—'}</dd></div>
          <div><dt>Timer</dt><dd>${TIERS[tier].time / 60} min</dd></div>
          ${superMega ? `<div><dt>Shields</dt><dd>${shields}</dd></div>` : ''}
        </dl>
      </div>
    </section>
    ${superMega ? superMegaPanel(shields, shieldBreakers, tier) : ''}
    ${TIERS[tier].shadow ? `
    <section class="panel note">
      <h2>Shadow raid</h2>
      <p>Shadow bosses become enraged partway through and hit much harder. Use Purified Gems to calm them down, and bring sturdy counters.</p>
    </section>` : ''}

    <section class="panel">
      <h2>Weaknesses</h2>
      <div class="matchups">${weak.map((t) => `<span class="matchup ${t.mult > 2 ? 'double' : ''}">${typeBadge(t.type)} ${fmtMult(t.mult)}</span>`).join('') || 'None'}</div>
      <h3>Resists</h3>
      <div class="matchups">${resist.map((t) => `<span class="matchup">${typeBadge(t.type)} ${fmtMult(t.mult)}</span>`).join('') || 'None'}</div>
    </section>

    <section class="panel">
      <h2>Raid settings</h2>
      <form id="settings" class="settings">
        <label>Your Pokémon level
          <select name="level">
            ${[40, 50].map((l) => `<option value="${l}" ${settings.level === l ? 'selected' : ''}>Level ${l}</option>`).join('')}
          </select>
        </label>
        <label>Weather
          <select name="weather">
            <option value="">No boost</option>
            ${Object.keys(data.weather).map((w) => `<option ${settings.weather === w ? 'selected' : ''}>${w}</option>`).join('')}
          </select>
        </label>
        <label>Boss moveset
          <select name="bossMoves">
            <option value="">Any (average)</option>
            ${bossMovePairs.map(([f, c]) => {
              const v = `${f},${c}`;
              return `<option value="${v}" ${bossMoves && bossMoves.join() === v ? 'selected' : ''}>${esc(moveName(f))} / ${esc(moveName(c))}</option>`;
            }).join('')}
          </select>
        </label>
        <fieldset>
          <label><input type="checkbox" name="megas" ${settings.megas ? 'checked' : ''}> Megas</label>
          <label><input type="checkbox" name="shadows" ${settings.shadows ? 'checked' : ''}> Shadows</label>
          <label><input type="checkbox" name="legendaries" ${settings.legendaries ? 'checked' : ''}> Legendaries</label>
          <label><input type="checkbox" name="elite" ${settings.elite ? 'checked' : ''}> Elite TM moves</label>
        </fieldset>
      </form>
    </section>

    <section class="panel">
      <h2>Suggested raid parties</h2>
      ${partyBlock('Best team', party, tier, shields, superMega
    ? 'Led by the best Mega for breaking shields, then the strongest five other Pokémon.'
    : 'The strongest six different Pokémon (one Mega at most).')}
      ${partyBlock('Budget team', budget, tier, shields, superMega
    ? 'A non-Legendary Mega to break a shield, then no Shadows or Legendaries.'
    : 'No Megas, Shadows or Legendaries — Pokémon most trainers can build.')}
    </section>

    <section class="panel">
      <h2>Top counters</h2>
      <p class="hint">Rating is relative to the #1 counter. DPS = damage per second, TDO = total damage before fainting. * = Elite TM / legacy move.</p>
      <div class="table-wrap">
        <table class="counters">
          <thead><tr><th>#</th><th>Pokémon</th><th>Moves</th><th>DPS</th><th>TDO</th><th>Rating</th></tr></thead>
          <tbody id="counter-rows">${counterRows(counters.slice(0, COUNTERS_SHOWN), superMega)}</tbody>
        </table>
      </div>
      ${counters.length > COUNTERS_SHOWN ? '<button id="more" class="more">Show more counters</button>' : ''}
    </section>

    <section class="panel">
      <h2>Best moves for ${esc(caught.name)}</h2>
      <p class="hint">If you catch it: its strongest movesets for raiding, against a neutral target.</p>
      <ol class="movesets">
        ${ownMovesets.map((m) => `<li>${moveBadge(m.fast, caught.eliteFast.includes(m.fast))} + ${moveBadge(m.charged, caught.eliteCharged.includes(m.charged))} <span class="muted">${m.dps.toFixed(1)} DPS</span></li>`).join('')}
      </ol>
      <h3>Moves the boss can use</h3>
      <div class="moves">${[...p.fast, ...p.charged].map((m) => moveBadge(m)).join('')}</div>
    </section>`;

  let shown = COUNTERS_SHOWN;
  app.querySelector('#more')?.addEventListener('click', (e) => {
    shown += COUNTERS_SHOWN;
    app.querySelector('#counter-rows').innerHTML = counterRows(counters.slice(0, shown), superMega);
    if (shown >= counters.length) e.target.remove();
  });

  app.querySelector('#settings').addEventListener('change', (e) => {
    const f = e.currentTarget.elements;
    if (e.target.name === 'bossMoves') {
      history.replaceState(null, '', `#/boss/${tier}/${key}${f.bossMoves.value ? `/${f.bossMoves.value}` : ''}`);
      return route({ keepScroll: true });
    }
    Object.assign(settings, {
      level: Number(f.level.value),
      weather: f.weather.value,
      megas: f.megas.checked,
      shadows: f.shadows.checked,
      legendaries: f.legendaries.checked,
      elite: f.elite.checked,
    });
    saveSettings();
    route({ keepScroll: true });
  });
}

function superMegaPanel(shields, breakers, tier) {
  const trueMega = tier === 'super_mega_5';
  return `
    <section class="panel note">
      <h2>Super Mega raid</h2>
      <p>This boss starts with <strong>${shields} shields</strong>. While they're up it deals ${SHIELD_ATK}× damage and
      takes ${SHIELD_DEF}× less. Only a <strong>Mega-Evolved</strong> Pokémon${trueMega ? ' (not Primal Kyogre or Groudon)' : ''}
      can break a shield, with a charged attack, and each trainer can break just one.
      So you need <strong>at least ${shields} trainers, each with a Mega</strong> in their team.</p>
      <h3>Best Megas to bring</h3>
      <ol class="party-list">
        ${breakers.map((c) => `
          <li>
            <img src="${sprite(c.dex)}" alt="" loading="lazy" width="56" height="56" onerror="this.style.visibility='hidden'">
            <strong>${esc(c.name)}</strong>
            <span>${moveBadge(c.fast, data.pokemon[c.key].eliteFast.includes(c.fast))}</span>
            <span>${moveBadge(c.charged, data.pokemon[c.key].eliteCharged.includes(c.charged))}</span>
          </li>`).join('')}
      </ol>
    </section>`;
}

function partyBlock(title, party, tier, shields, blurb) {
  if (!party.length) return '';
  const trainers = trainersNeeded(party, tier, shields);
  return `
    <div class="party">
      <div class="party-head">
        <h3>${title}</h3>
        <span class="trainers" title="Rough estimate, assuming every trainer brings this team">~${trainers} trainer${trainers > 1 ? 's' : ''} needed</span>
      </div>
      <p class="hint">${blurb}</p>
      <ol class="party-list">
        ${party.map((c) => `
          <li>
            <img src="${sprite(c.dex)}" alt="" loading="lazy" width="56" height="56" onerror="this.style.visibility='hidden'">
            <strong>${esc(c.name)}</strong>
            <span>${moveBadge(c.fast, data.pokemon[c.key].eliteFast.includes(c.fast))}</span>
            <span>${moveBadge(c.charged, data.pokemon[c.key].eliteCharged.includes(c.charged))}</span>
          </li>`).join('')}
      </ol>
    </div>`;
}

function counterRows(rows, superMega) {
  return rows.map((c, i) => {
    const p = data.pokemon[c.key];
    const breaker = superMega && canBreakShields(c) ? ' <span class="status status-now">Breaks shields</span>' : '';
    return `
      <tr>
        <td>${i + 1}</td>
        <td><span class="cname">${esc(c.name)}</span>${breaker}<div>${typeBadges(c.types)}</div></td>
        <td>${moveBadge(c.fast, p.eliteFast.includes(c.fast))}<br>${moveBadge(c.charged, p.eliteCharged.includes(c.charged))}</td>
        <td>${c.dps.toFixed(1)}</td>
        <td>${Math.round(c.tdo)}</td>
        <td><div class="bar"><span style="width:${c.rating}%"></span></div>${c.rating}</td>
      </tr>`;
  }).join('');
}

// ---------- Routing ----------

function route({ keepScroll = false } = {}) {
  const [, page, tier, key, moves] = location.hash.split('/');
  if (page === 'boss') {
    renderBoss(tier, key, moves ? moves.split(',') : undefined);
    if (!keepScroll) window.scrollTo({ top: 0 });
  } else {
    renderList();
  }
}

async function start() {
  try {
    const res = await fetch('data/game.json');
    data = await res.json();
  } catch {
    app.innerHTML = '<p class="empty">Could not load raid data. Check your connection and refresh.</p>';
    return;
  }
  document.getElementById('data-date').textContent = `Updated ${new Date(data.generated).toLocaleDateString()}.`;
  window.addEventListener('hashchange', () => route());
  route();
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
start();
