// "Power up?" and single-Pokémon ("Look up") pages.

import { matchups, bestMovesetsOverall } from './calc.js';
import { cpAt, cpmAt, estimateLevel, AVERAGE_IVS } from './collection.js';
import { adviseAll, adviseEntry, typeRanksFor, bossPlacement } from './advice.js';
import { readScreenshot, readPokemon } from './scan.js';

const VERDICT_CLASS = { power: 'status-now', ready: 'status-soon', maybe: '', skip: 'status-skip' };
const fmt = (n) => n.toLocaleString();
const ordinal = (n) => `#${n}`;

// A screenshot read on the Look up page, kept so the page can show "your" copy.
let scanned = null;

function adviceReasons(ctx, a) {
  const { data, esc } = ctx;
  const reasons = a.typeRanks.slice(0, 2).map((t) => `${ordinal(t.rank)} ${t.type} attacker`);
  for (const b of a.usefulAgainst.slice(0, 3)) {
    reasons.push(`${ordinal(b.placement.rank)} counter for <a href="#/boss/${b.tier}/${b.key}">${esc(ctx.bossName(b))}</a>`);
  }
  for (const b of a.maxUses.slice(0, 2)) reasons.push(`Top Max attacker vs <a href="#/boss/${b.tier}/${b.key}">${esc(ctx.bossName(b))}</a>`);
  const family = data.pokemon[a.entry.key].family;
  const cost = a.cost && (a.verdict === 'power' || a.verdict === 'maybe')
    ? `To level 40: <strong>${fmt(a.cost.stardust)}</strong> stardust and <strong>${fmt(a.cost.candy)}</strong> ${esc(titleCase(family || ''))} Candy`
    : '';
  return { reasons, cost };
}

const titleCase = (s) => s.toLowerCase().replace(/(^|[_\s])(\w)/g, (_, sp, c) => `${sp ? ' ' : ''}${c.toUpperCase()}`);

function adviceCard(ctx, a, { link = true } = {}) {
  const { data, esc, sprite, moveBadge } = ctx;
  const p = data.pokemon[a.entry.key];
  const e = a.entry;
  const { reasons, cost } = adviceReasons(ctx, a);
  const name = `${e.shadow ? 'Shadow ' : ''}${p.name}`;
  return `
    <li class="mine-card advice">
      <img src="${sprite(p.dex)}" alt="" loading="lazy" width="56" height="56" onerror="this.style.visibility='hidden'">
      <div class="mine-body">
        <span><span class="status ${VERDICT_CLASS[a.verdict]}">${a.label}</span></span>
        <strong>${link ? `<a href="#/pokemon/${e.key}">${esc(name)}</a>` : esc(name)}</strong>
        <span class="muted">CP ${e.cp} · Lv ${e.level}${e.ivs ? ` · IVs ${e.ivs.atk}/${e.ivs.def}/${e.ivs.sta}` : ''}</span>
        <div class="moves">${moveBadge(e.fast)}${e.charged.map((c) => moveBadge(c)).join('')}</div>
        ${reasons.length ? `<ul class="reasons">${reasons.map((r) => `<li>${r}</li>`).join('')}</ul>` : '<p class="hint">Not a top raider of any type, and not a top counter for the current bosses.</p>'}
        ${cost ? `<p class="hint">${cost}</p>` : ''}
        ${a.notes.map((n) => `<p class="hint">💡 ${esc(n)}</p>`).join('')}
      </div>
    </li>`;
}

export function renderPowerUp(app, ctx) {
  const { data, esc } = ctx;
  const collection = ctx.getCollection();
  document.title = 'Power up? · Raid Boss Guide';
  if (!collection.length) {
    app.innerHTML = `
      <section class="rotation-head"><h1>Power up?</h1></section>
      <p class="hint">Add your Pokémon on <a href="#/mine">My Pokémon</a> (by hand or from screenshots) and this page
      will tell you which ones are worth your stardust.</p>`;
    return;
  }
  app.innerHTML = '<p class="loading">Working out who to power up…</p>';
  // Let the loading message paint before the (sub-second) calculation.
  setTimeout(() => {
    const advice = ctx.adviceContext();
    const all = adviseAll(data, collection, advice);
    const groups = ['power', 'ready', 'maybe', 'skip'].map((v) => [v, all.filter((a) => a.verdict === v)]).filter(([, list]) => list.length);
    app.innerHTML = `
      <section class="rotation-head">
        <h1>Power up?</h1>
        <p class="hint">Based on how each of your Pokémon ranks among the best attackers of its type, and how it would do
        at level 40 against the raids running now or coming up
        (${advice.bosses.map((b) => esc(ctx.bossName(b))).join(', ') || 'none announced'}).</p>
      </section>
      ${groups.map(([v, list]) => `
        <section class="panel">
          <h2>${list[0].label} <small class="muted">(${list.length})</small></h2>
          <ul class="mine-list">${list.map((a) => adviceCard(ctx, a)).join('')}</ul>
        </section>`).join('')}`;
  });
}

export function renderPokemon(app, ctx, key) {
  const { data, esc, sprite, typeBadge, typeBadges, moveBadge } = ctx;
  const species = Object.entries(data.pokemon)
    .filter(([, p]) => p.released && !p.gmax && p.fast.length)
    .sort(([, a], [, b]) => a.name.localeCompare(b.name));
  const byName = new Map(species.map(([k, p]) => [p.name.toLowerCase(), k]));
  const p = key && data.pokemon[key];
  document.title = p ? `${p.name} · Raid Boss Guide` : 'Look up a Pokémon · Raid Boss Guide';

  const lookup = `
    <section class="panel">
      <h2>Look up a Pokémon</h2>
      <form id="lookup" class="settings mine-form" autocomplete="off">
        <label>Pokémon<input name="species" list="lookup-list" placeholder="Start typing, e.g. Garchomp" value="${p ? esc(p.name) : ''}">
          <datalist id="lookup-list">${species.map(([, s]) => `<option value="${esc(s.name)}">`).join('')}</datalist></label>
        <div class="form-actions">
          <label class="button">Or use a screenshot<input type="file" id="lookup-shot" accept="image/*" hidden></label>
        </div>
        <p class="hint" id="lookup-msg" role="status"></p>
      </form>
    </section>`;

  if (!p) {
    app.innerHTML = `<section class="rotation-head"><h1>Look up a Pokémon</h1>
      <p class="hint">See how good any Pokémon is for raids: its best moves, how it ranks, which current bosses it's good against,
      and what to do with yours. Pick one, or upload a screenshot of it from Pokémon GO.</p></section>${lookup}`;
    return bindLookup(app, ctx, byName);
  }

  const advice = ctx.adviceContext();
  const full = { atk: 15, def: 15, sta: 15 };
  const movesets = p.mega ? [] : bestMovesetsOverall(p, data, { level: 40, elite: true }).slice(0, 5);
  const ranks = typeRanksFor(advice.rankings, key, false).slice(0, 3);
  const shadowRanks = p.shadow ? typeRanksFor(advice.rankings, key, true).slice(0, 3) : [];
  const goodAgainst = advice.bosses
    .flatMap((b) => (p.shadow ? [false, true] : [false])
      .map((shadow) => ({ ...b, shadow, placement: bossPlacement(data, b.counters, b.key, b.tier, key, { shadow }) })))
    .filter((b) => b.placement && b.placement.rank <= 25)
    .sort((a, b) => a.placement.rank - b.placement.rank);
  const defence = matchups(p.types, data);
  const yours = ctx.getCollection().filter((e) => e.key === key).map((e) => adviseEntry(data, e, advice));
  const scan = scanned && scanned.key === key ? scanned : null;
  const scanEntry = scan && scan.cp ? {
    id: 'scan', key, cp: scan.cp, ivs: scan.ivs,
    level: scan.level ?? estimateLevel(data, p, scan.cp, scan.ivGuess || AVERAGE_IVS),
    fast: scan.fast || p.fast[0], charged: scan.charged.length ? scan.charged : [p.charged[0]],
    shadow: Boolean(scan.shadow), dynamax: Boolean(scan.dynamax || scan.gmax), gmax: Boolean(scan.gmax),
  } : null;

  app.innerHTML = `
    <section class="boss-head">
      <img src="${sprite(p.dex)}" alt="" width="120" height="120" onerror="this.style.visibility='hidden'">
      <div>
        <h1>${esc(p.name)} <small>#${p.dex}</small></h1>
        <div>${typeBadges(p.types)}${p.dynamax ? ' <span class="status">Can Dynamax</span>' : ''}${data.pokemon[`${key}_GIGANTAMAX`] ? ' <span class="status">Gigantamax form</span>' : ''}</div>
        <dl class="facts">
          <div><dt>Attack</dt><dd>${p.atk}</dd></div>
          <div><dt>Defence</dt><dd>${p.def}</dd></div>
          <div><dt>HP (stamina)</dt><dd>${p.sta}</dd></div>
          <div><dt>Max CP (Lv 40)</dt><dd>${fmt(cpAt(p, cpmAt(data, 40), full))}</dd></div>
          <div><dt>Max CP (Lv 50)</dt><dd>${fmt(cpAt(p, cpmAt(data, 50), full))}</dd></div>
        </dl>
      </div>
    </section>

    ${scanEntry ? `
    <section class="panel party-yours">
      <h2>The one in your screenshot</h2>
      <ul class="mine-list">${adviceCard(ctx, adviseEntry(data, scanEntry, advice), { link: false })}</ul>
      ${scan.problems.length ? `<p class="error">${scan.problems.map(esc).join(' ')}</p>` : ''}
      <div class="form-actions"><button type="button" class="button primary" id="scan-add">Add to My Pokémon</button></div>
    </section>` : ''}

    ${yours.length ? `
    <section class="panel">
      <h2>Your ${esc(p.name)}${yours.length > 1 ? ` (${yours.length})` : ''}</h2>
      <ul class="mine-list">${yours.map((a) => adviceCard(ctx, a, { link: false })).join('')}</ul>
    </section>` : ''}

    <section class="panel">
      <h2>How good is it for raids?</h2>
      ${ranks.length || shadowRanks.length ? `<ul class="reasons">
        ${ranks.map((r) => `<li>${ordinal(r.rank)} ${typeBadge(r.type)} attacker (${moveBadge(r.fast)} + ${moveBadge(r.charged)})</li>`).join('')}
        ${shadowRanks.map((r) => `<li>Shadow: ${ordinal(r.rank)} ${typeBadge(r.type)} attacker</li>`).join('')}
      </ul>` : '<p class="hint">Not ranked as a raid attacker.</p>'}
      <p class="hint">Rank among all non-Mega attackers of that type at level 40 (Shadows count separately).</p>
      ${movesets.length ? `
      <h3>Best raid movesets</h3>
      <ol class="movesets">${movesets.map((m) => `<li>${moveBadge(m.fast, p.eliteFast.includes(m.fast))} + ${moveBadge(m.charged, p.eliteCharged.includes(m.charged))} <span class="muted">${m.dps.toFixed(1)} DPS</span></li>`).join('')}</ol>` : ''}
    </section>

    <section class="panel">
      <h2>Good against now and coming up</h2>
      ${goodAgainst.length ? `<ul class="reasons">${goodAgainst.map((b) => `<li><a href="#/boss/${b.tier}/${b.key}">${esc(ctx.bossName(b))}</a>: ${b.shadow ? 'Shadow version is the ' : ''}${ordinal(b.placement.rank)} counter with ${moveBadge(b.placement.fast)} + ${moveBadge(b.placement.charged)}</li>`).join('')}</ul>`
    : '<p class="hint">Not a top-25 counter for any raid boss running now or coming up.</p>'}
    </section>

    <section class="panel">
      <h2>Weak to</h2>
      <div class="matchups">${defence.filter((t) => t.mult > 1.001).map((t) => `<span class="matchup ${t.mult > 2 ? 'double' : ''}">${typeBadge(t.type)} ${t.mult.toFixed(2).replace(/0$/, '')}×</span>`).join('')}</div>
    </section>
    ${lookup}`;

  app.querySelector('#scan-add')?.addEventListener('click', (e) => {
    ctx.setCollection([...ctx.getCollection(), { ...scanEntry, id: crypto.randomUUID() }]);
    scanned = null;
    e.target.replaceWith(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'Added to My Pokémon.' }));
  });
  bindLookup(app, ctx, byName);
}

function bindLookup(app, ctx, byName) {
  const form = app.querySelector('#lookup');
  const msg = app.querySelector('#lookup-msg');
  const go = () => {
    const key = byName.get(form.elements.species.value.trim().toLowerCase());
    if (key) location.hash = `#/pokemon/${key}`;
  };
  form.elements.species.addEventListener('change', go);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    go();
  });
  app.querySelector('#lookup-shot').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    msg.textContent = 'Reading the screenshot… (the first one takes a little longer)';
    try {
      const shot = await readScreenshot(file);
      if (shot.kind === 'storage') {
        msg.textContent = "That's your storage list. Tap the Pokémon in Pokémon GO and screenshot its own page instead.";
        return;
      }
      const result = readPokemon(shot.parsed, ctx.data);
      if (!result.key) {
        msg.textContent = "Couldn't tell which Pokémon that is. Try a screenshot of its page in Pokémon GO, or pick it above.";
        return;
      }
      scanned = result;
      if (location.hash === `#/pokemon/${result.key}`) ctx.rerender();
      else location.hash = `#/pokemon/${result.key}`;
    } catch (err) {
      msg.textContent = err.message || "Couldn't read that screenshot.";
    }
  });
}
