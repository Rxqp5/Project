import {
  TIERS, matchups, boostedWeather, bossStats, catchCP, rankCounters, pickParty, budgetFilter,
  trainersNeeded, bestMovesetsOverall,
} from './calc.js';

const app = document.getElementById('app');
const TIER_ORDER = ['1', '2', '3', '4', '5', 'mega', 'mega_legendary', 'primal'];
const TIER_SHORT = { 1: '1★', 2: '2★', 3: '3★', 4: '4★', 5: '5★', mega: 'Mega', mega_legendary: 'Mega Legendary', primal: 'Primal' };
const COUNTERS_SHOWN = 20;

let data;
const listState = { tier: 'all', query: '' };
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

// ---------- Boss list ----------

function bossList() {
  const q = listState.query.trim().toLowerCase();
  return data.raids
    .filter((r) => listState.tier === 'all' || r.tier === listState.tier)
    .filter((r) => !q || data.pokemon[r.key].name.toLowerCase().includes(q)
      || data.pokemon[r.key].types.some((t) => t.toLowerCase() === q))
    .sort((a, b) => TIER_ORDER.indexOf(b.tier) - TIER_ORDER.indexOf(a.tier)
      || data.pokemon[a.key].dex - data.pokemon[b.key].dex
      || data.pokemon[a.key].name.localeCompare(data.pokemon[b.key].name));
}

function renderList() {
  document.title = 'Raid Boss Guide';
  const counts = Object.fromEntries(TIER_ORDER.map((t) => [t, data.raids.filter((r) => r.tier === t).length]));
  const tabs = [['all', `All (${data.raids.length})`], ...TIER_ORDER.filter((t) => counts[t]).map((t) => [t, `${TIER_SHORT[t]} (${counts[t]})`])];
  app.innerHTML = `
    <section class="controls">
      <input id="search" type="search" placeholder="Search a Pokémon or type (e.g. Mewtwo, Dragon)" value="${esc(listState.query)}" autocomplete="off">
      <div class="tabs" role="tablist">
        ${tabs.map(([t, label]) => `<button role="tab" data-tier="${t}" aria-selected="${listState.tier === t}">${label}</button>`).join('')}
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
            <span class="tier tier-${r.tier}">${TIER_SHORT[r.tier]}</span>
            <strong>${esc(p.name)}</strong>
            <div>${typeBadges(p.types)}</div>
          </div>
        </a>`;
    }).join('')
    : '<p class="empty">No raid bosses match that search.</p>';
}

// ---------- Boss detail ----------

function counterOptions(bossMoves) {
  return { ...settings, bossMoves };
}

function countersFor(key, tier, bossMoves) {
  const opts = counterOptions(bossMoves);
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
  document.title = `${p.name} raid guide`;
  const boss = bossStats(p, tier);
  const caught = data.pokemon[p.base] || p; // Megas are caught in their normal form
  const normalCp = catchCP(caught);
  const boostedCp = catchCP(caught, true);
  const types = matchups(p.types, data);
  const weak = types.filter((t) => t.mult > 1.001);
  const resist = types.filter((t) => t.mult < 0.999).reverse();
  const counters = countersFor(key, tier, bossMoves);
  const party = pickParty(counters);
  const budget = pickParty(counters, budgetFilter);
  const ownMovesets = bestMovesetsOverall(caught, data, { level: settings.level, elite: true }).slice(0, 5);
  const bossMovePairs = p.fast.flatMap((f) => p.charged.map((c) => [f, c]));

  app.innerHTML = `
    <a href="#/" class="back">← All raid bosses</a>
    <section class="boss-head">
      <img src="${sprite(p.dex)}" alt="" width="120" height="120" onerror="this.style.visibility='hidden'">
      <div>
        <span class="tier tier-${tier}">${TIERS[tier].label} raid</span>
        <h1>${esc(p.name)} <small>#${p.dex}</small></h1>
        <div>${typeBadges(p.types)}</div>
        <dl class="facts">
          <div><dt>Boss CP</dt><dd>${boss.cp.toLocaleString()}</dd></div>
          <div><dt>Boss HP</dt><dd>${boss.hp.toLocaleString()}</dd></div>
          <div><dt>Catch CP</dt><dd>${normalCp.min}–${normalCp.max}</dd></div>
          <div><dt>Weather boosted</dt><dd>${boostedCp.min}–${boostedCp.max}</dd></div>
          <div><dt>Boosted in</dt><dd>${boostedWeather(p.types, data).join(', ') || '—'}</dd></div>
          <div><dt>Timer</dt><dd>${TIERS[tier].time / 60} min</dd></div>
        </dl>
      </div>
    </section>

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
      ${partyBlock('Best team', party, tier, 'The strongest six different Pokémon (one Mega at most).')}
      ${partyBlock('Budget team', budget, tier, 'No Megas, Shadows or Legendaries — Pokémon most trainers can build.')}
    </section>

    <section class="panel">
      <h2>Top counters</h2>
      <p class="hint">Rating is relative to the #1 counter. DPS = damage per second, TDO = total damage before fainting. * = Elite TM / legacy move.</p>
      <div class="table-wrap">
        <table class="counters">
          <thead><tr><th>#</th><th>Pokémon</th><th>Moves</th><th>DPS</th><th>TDO</th><th>Rating</th></tr></thead>
          <tbody id="counter-rows">${counterRows(counters.slice(0, COUNTERS_SHOWN))}</tbody>
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
    app.querySelector('#counter-rows').innerHTML = counterRows(counters.slice(0, shown));
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

function partyBlock(title, party, tier, blurb) {
  if (!party.length) return '';
  const trainers = trainersNeeded(party, tier);
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

function counterRows(rows) {
  return rows.map((c, i) => {
    const p = data.pokemon[c.key];
    return `
      <tr>
        <td>${i + 1}</td>
        <td><span class="cname">${esc(c.name)}</span><div>${typeBadges(c.types)}</div></td>
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
