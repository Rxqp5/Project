import {
  TIERS, SHIELD_ATK, SHIELD_DEF, matchups, boostedWeather, bossStats, catchCP, rankCounters, pickParty,
  budgetFilter, canBreakShields, trainersNeeded, bestMovesetsOverall, rankMaxAttackers, rankMaxTanks,
  pickMaxTeam,
} from './calc.js';
import { SCHEDULE_URLS, scheduleItems, lineupItems, rotationDays } from './schedule.js';
import { rankOwned, rankOwnedMax, moveTips, loadCollection, saveCollection } from './collection.js';
import { renderMine } from './mine.js';
import { renderPowerUp, renderPokemon } from './pokemon-pages.js';
import { typeRankings, maxTopAttackers } from './advice.js';

const app = document.getElementById('app');
const TIER_ORDER = ['1', '2', '3', '4', '5', 'elite', 'shadow_1', 'shadow_3', 'shadow_5',
  'mega', 'mega_legendary', 'primal', 'super_mega_4', 'super_mega_5',
  'max_1', 'max_2', 'max_3', 'max_4', 'max_5', 'max_6'];
const TIER_SHORT = {
  1: '1★', 2: '2★', 3: '3★', 4: '4★', 5: '5★', elite: 'Elite',
  shadow_1: 'Shadow 1★', shadow_3: 'Shadow 3★', shadow_5: 'Shadow 5★',
  mega: 'Mega', mega_legendary: 'Mega Legendary', primal: 'Primal',
  super_mega_4: 'Super Mega 4★', super_mega_5: 'Super Mega 5★',
  max_1: 'Dynamax 1★', max_2: 'Dynamax 2★', max_3: 'Dynamax 3★', max_4: 'Dynamax 4★', max_5: 'Dynamax 5★',
  max_6: 'Gigantamax',
};
const COUNTERS_SHOWN = 20;

let data;
let schedule; // { events, lineup, fetched, live }
const listState = { tier: 'all', query: '' };
const settings = loadSettings();
let collection = loadCollection(safeStorage());

function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    // Storage blocked (private browsing): keep the collection for this visit only.
    const mem = new Map();
    return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  }
}
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
const fmtDay = (d) => d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = (d) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const fmtDateTime = (d) => `${fmtDay(d)}, ${fmtTime(d)}`;
function bossName(r) {
  const p = data.pokemon[r.key];
  if (TIERS[r.tier].shadow) return `Shadow ${p.name}`;
  if (TIERS[r.tier].max && !p.gmax) return `Dynamax ${p.name}`;
  return p.name;
}
const findRaid = (tier, key) => data.raids.find((r) => r.tier === tier && r.key === key);

function statusBadge(r) {
  if (r.status === 'current') return '<span class="status status-now">In raids now</span>';
  if (r.status === 'upcoming') return `<span class="status status-soon">${r.start ? `From ${fmtDate(r.start)}` : 'Coming soon'}</span>`;
  if (r.status === 'future') return '<span class="status">Not yet in raids</span>';
  return '';
}

// ---------- Boss list ----------

// Tabs: "all", "future" (could become a boss one day), or a tier.
// Every tab except "future" leaves out bosses that have never actually appeared.
const TAB_FILTERS = {
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
    .sort((a, b) => TIER_ORDER.indexOf(b.tier) - TIER_ORDER.indexOf(a.tier)
      || data.pokemon[a.key].dex - data.pokemon[b.key].dex
      || data.pokemon[a.key].name.localeCompare(data.pokemon[b.key].name));
}

function renderList() {
  document.title = 'Raid Boss Guide';
  const count = (tab) => data.raids.filter(tabFilter(tab)).length;
  const tabs = [['all', 'All'], ...TIER_ORDER, ['future', 'Possible future']]
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
  const isMax = Boolean(TIERS[tier].max);
  const battle = isMax ? maxSections(key, tier, bossMoves) : raidSections(key, tier, bossMoves, superMega, shields);
  const ownMovesets = bestMovesetsOverall(caught, data, { level: settings.level, elite: true }).slice(0, 5);
  const bossMovePairs = p.fast.flatMap((f) => p.charged.map((c) => [f, c]));

  app.innerHTML = `
    <a href="#/bosses" class="back">← All raid bosses</a>
    <section class="boss-head">
      <img src="${sprite(p.dex)}" alt="" width="120" height="120" onerror="this.style.visibility='hidden'">
      <div>
        <span class="tier tier-${tier}">${TIERS[tier].label} ${isMax ? 'Max Battle' : 'raid'}</span> ${statusBadge(raid)}
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
    ${battle.intro}
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
      <h2>${isMax ? 'Battle' : 'Raid'} settings</h2>
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
          ${isMax ? '' : `
          <label><input type="checkbox" name="megas" ${settings.megas ? 'checked' : ''}> Megas</label>
          <label><input type="checkbox" name="shadows" ${settings.shadows ? 'checked' : ''}> Shadows</label>
          <label><input type="checkbox" name="legendaries" ${settings.legendaries ? 'checked' : ''}> Legendaries</label>`}
          <label><input type="checkbox" name="elite" ${settings.elite ? 'checked' : ''}> Elite TM moves</label>
        </fieldset>
      </form>
    </section>

    ${battle.body}

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
    app.querySelector('#counter-rows').innerHTML = battle.rows(shown);
    if (shown >= battle.total) e.target.remove();
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
      megas: f.megas ? f.megas.checked : settings.megas,
      shadows: f.shadows ? f.shadows.checked : settings.shadows,
      legendaries: f.legendaries ? f.legendaries.checked : settings.legendaries,
      elite: f.elite.checked,
    });
    saveSettings();
    route({ keepScroll: true });
  });
}

const moreButton = (total) => (total > COUNTERS_SHOWN ? '<button id="more" class="more">Show more</button>' : '');

// Counters, parties and (for Super Mega) shield breakers for a normal raid.
function raidSections(key, tier, bossMoves, superMega, shields) {
  const counters = countersFor(key, tier, bossMoves);
  const party = pickParty(counters, undefined, { requireMega: superMega });
  const budget = pickParty(counters, budgetFilter, { requireMega: superMega });
  const rows = (n) => counterRows(counters.slice(0, n), superMega);
  const owned = rankOwned(data, key, tier, collection, { weather: settings.weather, bossMoves });
  const yours = pickParty(owned, undefined, { requireMega: superMega, idOf: (c) => c.entryId });
  const tips = yours.length ? moveTips(owned, yours) : [];
  return {
    total: counters.length,
    rows,
    intro: superMega ? superMegaPanel(shields, counters.filter(canBreakShields).slice(0, 6), tier) : '',
    body: `
    <section class="panel">
      <h2>Suggested raid parties</h2>
      ${partyBlock('Best team', party, tier, shields, superMega
    ? 'Led by the best Mega for breaking shields, then the strongest five other Pokémon.'
    : 'The strongest six different Pokémon (one Mega at most).')}
      ${yourTeamBlock(yours, tier, shields, superMega, tips)}
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
          <tbody id="counter-rows">${rows(COUNTERS_SHOWN)}</tbody>
        </table>
      </div>
      ${moreButton(counters.length)}
    </section>`,
  };
}

// Max Battles: Dynamax attackers, tanks and a team of three.
function maxSections(key, tier, bossMoves) {
  const opts = { level: settings.level, weather: settings.weather, elite: settings.elite, bossMoves };
  const attackers = rankMaxAttackers(data, key, tier, opts);
  const tanks = rankMaxTanks(data, key, tier, opts);
  const team = pickMaxTeam(attackers, tanks);
  const owned = rankOwnedMax(data, key, tier, collection, opts);
  const yours = pickMaxTeam(owned.attackers, owned.tanks, { idOf: (c) => c.entryId });
  const maxMove = (a) => `${typeBadge(a.maxType)}${a.gmaxMove ? ' <span class="status status-soon">G-Max</span>' : ''}`;
  const rows = (n) => attackers.slice(0, n).map((a, i) => `
      <tr>
        <td>${i + 1}</td>
        <td><span class="cname">${esc(a.name)}</span><div>${typeBadges(a.types)}</div></td>
        <td>${moveBadge(a.fast, data.pokemon[a.key].eliteFast.includes(a.fast))}</td>
        <td>${maxMove(a)}</td>
        <td>${a.maxDamage.toLocaleString()}</td>
        <td><div class="bar"><span style="width:${a.rating}%"></span></div>${a.rating}</td>
      </tr>`).join('');
  return {
    total: attackers.length,
    rows,
    intro: `
    <section class="panel note">
      <h2>Max Battle</h2>
      <p>Only <strong>Dynamax</strong> Pokémon can join, three per trainer${tier === 'max_6' ? ', with up to 40 trainers' : ', up to four trainers'}.
      Fast attacks fill your Max Meter; once full you Dynamax for three turns and choose
      <strong>Max Attack</strong> (its type is your fast move's type), <strong>Max Guard</strong> (shield the team) or
      <strong>Max Spirit</strong> (heal the team). Gigantamax Pokémon use a stronger G-Max move when their fast move matches it.</p>
    </section>`,
    body: `
    <section class="panel">
      <h2>Suggested team</h2>
      <p class="hint">Two hard hitters and a tank to take the boss's attacks. Bring Max Guard / Max Spirit on the tank.</p>
      <ol class="party-list">
        ${team.map((c) => maxTeamCard(c, maxMove)).join('')}
      </ol>
    </section>

    <section class="panel">
      ${yours.length ? `
      <div class="party party-yours">
        <h3>Your best Max team</h3>
        <p class="hint">From your Pokémon marked Dynamax or Gigantamax on <a href="#/mine">My Pokémon</a>.</p>
        <ol class="party-list">${yours.map((c) => maxTeamCard(c, maxMove, true)).join('')}</ol>
      </div>` : addPokemonPrompt('Max team')}
    </section>

    <section class="panel">
      <h2>Best Max attackers</h2>
      <p class="hint">Ranked by the damage of one level-3 Max Attack against this boss. * = Elite TM / legacy move.</p>
      <div class="table-wrap">
        <table class="counters">
          <thead><tr><th>#</th><th>Pokémon</th><th>Fast move</th><th>Max move</th><th>Damage</th><th>Rating</th></tr></thead>
          <tbody id="counter-rows">${rows(COUNTERS_SHOWN)}</tbody>
        </table>
      </div>
      ${moreButton(attackers.length)}
    </section>

    <section class="panel">
      <h2>Best tanks</h2>
      <p class="hint">How long each Pokémon lasts against the boss's attacks, before Max Guard.</p>
      <div class="table-wrap">
        <table class="counters">
          <thead><tr><th>#</th><th>Pokémon</th><th>HP</th><th>Survives</th></tr></thead>
          <tbody>${tanks.slice(0, 10).map((t, i) => `
            <tr>
              <td>${i + 1}</td>
              <td><span class="cname">${esc(t.name)}</span><div>${typeBadges(t.types)}</div></td>
              <td>${t.hp}</td>
              <td>~${Math.round(t.survival)}s</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>
    </section>`,
  };
}

function maxTeamCard(c, maxMove, owned = false) {
  return `
    <li>
      <img src="${sprite(c.dex)}" alt="" loading="lazy" width="56" height="56" onerror="this.style.visibility='hidden'">
      <span class="status">${c.role}</span>
      <strong>${esc(c.name)}</strong>
      ${owned ? `<span class="muted">CP ${c.cp} · Lv ${c.level}</span>` : ''}
      ${c.role === 'Tank' ? `<span class="muted">Survives ~${Math.round(c.survival)}s</span>` : `<span>${moveBadge(c.fast)}</span><span>${maxMove(c)}</span>`}
    </li>`;
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

const addPokemonPrompt = (what) => `
    <div class="party party-yours">
      <h3>Your best ${what}</h3>
      <p class="hint">${collection.length
    ? `None of your Pokémon can take part yet. <a href="#/mine">Add more on My Pokémon</a>.`
    : `See the best ${what} you can build from your own Pokémon. <a href="#/mine">Add your Pokémon</a>.`}</p>
    </div>`;

function yourTeamBlock(team, tier, shields, superMega, tips) {
  if (!team.length) return addPokemonPrompt('team');
  const noMega = superMega && !team.some(canBreakShields);
  return `
    ${partyBlock('Your best team', team, tier, shields, noMega
    ? '⚠️ None of your Pokémon can Mega Evolve, and you need a Mega to break a shield. Tick "I can Mega Evolve it" on My Pokémon for any you can.'
    : `From your ${collection.length} Pokémon, with the moves they have now.${team.length < 6 ? ` Only ${team.length} of yours fit; add more on <a href="#/mine">My Pokémon</a>.` : ''}`, { owned: true })}
    ${tips.length ? `
      <div class="tips">
        <h4>Make your team stronger</h4>
        <ul>${tips.slice(0, 4).map((t) => `<li><strong>${esc(t.name)}</strong> (CP ${t.cp}): ${[
    t.newFast && `fast TM to ${moveBadge(t.newFast)}`,
    t.newCharged && `charged TM to ${moveBadge(t.newCharged)}`,
  ].filter(Boolean).join(' and ')}${t.elite ? ' (needs an Elite TM)' : ''} for about <strong>${Math.round(t.gain * 100)}% more damage</strong>${t.inTeam ? '' : ', which would earn it a team spot'}.</li>`).join('')}</ul>
      </div>` : ''}`;
}

function partyBlock(title, party, tier, shields, blurb, { owned = false } = {}) {
  if (!party.length) return '';
  const trainers = trainersNeeded(party, tier, shields);
  return `
    <div class="party${owned ? ' party-yours' : ''}">
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
            ${owned ? `<span class="muted">CP ${c.cp} · Lv ${c.level}${c.movesUnknown ? ' · moves not checked' : ''}</span>` : ''}
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
  document.querySelectorAll('.nav a').forEach((a) => a.toggleAttribute('aria-current',
    a.getAttribute('href') === `#/${page === 'boss' ? 'bosses' : page || ''}`));
  if (page === 'boss') renderBoss(tier, key, moves ? moves.split(',') : undefined);
  else if (page === 'bosses') renderList();
  else if (page === 'mine') {
    renderMine(app, {
      data, esc, sprite, typeBadges, moveBadge,
      getCollection: () => collection,
      setCollection: (list) => {
        collection = list;
        return saveCollection(safeStorage(), list);
      },
    });
  } else if (page === 'powerup') renderPowerUp(app, pageContext());
  else if (page === 'pokemon') renderPokemon(app, pageContext(), tier);
  else renderRotation();
  if (!keepScroll) window.scrollTo({ top: 0 });
}

function pageContext() {
  return {
    data, esc, sprite, typeBadge, typeBadges, moveBadge, bossName,
    getCollection: () => collection,
    setCollection: (list) => {
      collection = list;
      return saveCollection(safeStorage(), list);
    },
    adviceContext,
    rerender: () => route({ keepScroll: true }),
  };
}

// ---------- Advice ----------

let rankingsCache;
let bossesCache;

// The raid bosses running now or in the next two weeks, with their counters, plus current Max
// Battle bosses (3★ and up) with their best attackers. Used for power-up advice.
function adviceContext() {
  rankingsCache ||= typeRankings(data);
  const cacheKey = `${schedule?.fetched}|${JSON.stringify(settings)}`;
  if (bossesCache?.key !== cacheKey) {
    const now = new Date();
    const soon = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const dated = schedule ? scheduleItems(schedule.events, data).filter((i) => i.kind === 'boss' && i.key && i.end > now && i.start < soon) : [];
    const undated = schedule ? lineupItems(schedule.lineup, data).filter((i) => ['3', '5', 'mega', 'shadow_3'].includes(i.tier)) : [];
    const seen = new Set();
    const bosses = [];
    for (const { key, tier } of [...dated, ...undated]) {
      if (!TIERS[tier] || TIERS[tier].max || seen.has(`${tier}:${key}`)) continue;
      seen.add(`${tier}:${key}`);
      bosses.push({ key, tier, counters: countersFor(key, tier) });
    }
    const maxBosses = data.raids
      .filter((r) => r.status === 'current' && ['max_3', 'max_4', 'max_5', 'max_6'].includes(r.tier))
      .map((r) => ({ key: r.key, tier: r.tier, top: maxTopAttackers(data, r.key, r.tier) }));
    bossesCache = { key: cacheKey, bosses, maxBosses };
  }
  return { rankings: rankingsCache, bosses: bossesCache.bosses, maxBosses: bossesCache.maxBosses };
}

// ---------- Rotation ----------

const SPECIAL_LABELS = { 'raid-hour': 'Raid Hour', 'raid-day': 'Raid Day', 'max-mondays': 'Max Monday' };
// Tiers that only appear in LeekDuck's undated lineup (the others come with dates).
const UNDATED_TIERS = new Set(['1', '3', 'shadow_1', 'shadow_3']);

function rotationRow(item) {
  const p = item.key && data.pokemon[item.key];
  const name = p ? bossName(item) : item.name;
  const href = p ? `#/boss/${item.tier}/${item.key}` : item.link;
  const label = item.kind === 'special' ? SPECIAL_LABELS[item.type] || 'Event' : TIER_SHORT[item.tier] || '';
  let when = '';
  if (item.kind === 'special') when = `${fmtTime(item.start)} – ${fmtTime(item.end)}`;
  else if (item.first) when = `${fmtDateTime(item.start)} → ${fmtDateTime(item.end)}`;
  else if (item.endsToday) when = `Last day · ends ${fmtTime(item.end)}`;
  else if (item.kind === 'boss') when = `Until ${fmtDay(item.end)}`;
  return `
    <a class="rot ${item.kind === 'special' ? 'rot-special' : ''}" href="${esc(href)}" ${p ? '' : 'target="_blank" rel="noopener"'}>
      ${p ? `<img src="${sprite(p.dex)}" alt="" loading="lazy" width="48" height="48" onerror="this.style.visibility='hidden'">` : '<span class="rot-icon">★</span>'}
      <span class="rot-body">
        <span><span class="tier tier-${item.kind === 'special' ? 'special' : item.tier}">${label}</span>
          ${item.first && item.kind === 'boss' && item.startsToday ? '<span class="status status-soon">Starts today</span>' : ''}</span>
        <strong>${esc(name)}${item.shiny ? ' <span title="Can be shiny">✨</span>' : ''}</strong>
        ${when ? `<span class="rot-when${item.first ? ' rot-first' : ''}">${when}</span>` : ''}
      </span>
    </a>`;
}

function renderRotation() {
  document.title = 'Raid rotation · Raid Boss Guide';
  if (!schedule) {
    app.innerHTML = '<p class="loading">Loading the raid rotation…</p>';
    return;
  }
  const items = scheduleItems(schedule.events, data);
  const days = rotationDays(items);
  const lineup = lineupItems(schedule.lineup, data).filter((r) => UNDATED_TIERS.has(r.tier));
  const order = (i) => (i.kind === 'special' ? -1 : TIER_ORDER.length - TIER_ORDER.indexOf(i.tier));
  app.innerHTML = `
    <section class="rotation-head">
      <h1>Raid rotation</h1>
      <p class="hint">Times are your local time. Full dates are shown on the first day each boss appears.
      From <a href="https://leekduck.com/events/" target="_blank" rel="noopener">LeekDuck</a>,
      ${schedule.live ? 'checked just now' : `saved ${fmtDay(new Date(schedule.fetched))} (offline copy)`}.</p>
    </section>
    ${days.map((d, n) => `
      <section class="day">
        <h2>${n === 0 ? 'Today · ' : n === 1 ? 'Tomorrow · ' : ''}${fmtDay(d.date)}</h2>
        ${d.items.length ? `<div class="rot-list">${[...d.items].sort((a, b) => order(a) - order(b)).map(rotationRow).join('')}</div>`
    : '<p class="hint">No dated raids announced.</p>'}
        ${n === 0 && lineup.length ? `
          <h3>Also in raids now <span class="hint">(no end date announced)</span></h3>
          <div class="rot-list compact">${lineup.map(rotationRow).join('')}</div>` : ''}
      </section>`).join('')}`;
}

async function loadSchedule() {
  schedule = { ...data.schedule, live: false };
  try {
    const get = (url) => fetch(url, { signal: AbortSignal.timeout(8000) }).then((r) => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
    const [events, lineup] = await Promise.all([get(SCHEDULE_URLS.events), get(SCHEDULE_URLS.lineup)]);
    schedule = { events, lineup, fetched: new Date().toISOString(), live: true };
  } catch {
    // Offline or the feed is down: keep the copy saved when the data was built.
  }
  const page = location.hash.split('/')[1];
  if (!page || page === 'powerup' || page === 'pokemon') route({ keepScroll: true });
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
  loadSchedule();
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
start();
