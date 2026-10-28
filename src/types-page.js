// Type cheat sheet: the full type chart, and a page per type.

import { effectiveness } from './calc.js';
import { rankOwned } from './collection.js';

const short = (t) => t.slice(0, 3).toUpperCase();
const multLabel = (m) => (m > 1.001 ? `${m.toFixed(1)}×` : m < 0.5 ? '0.39×' : m < 0.999 ? '0.63×' : '');

function chart(ctx) {
  const { data, esc } = ctx;
  const cell = (atk, def) => {
    const m = data.typeChart[atk][def];
    const cls = m > 1.001 ? 'se' : m < 0.5 ? 'imm' : m < 0.999 ? 'nve' : '';
    return `<td class="${cls}" title="${esc(`${atk} attacking ${def}: ${m}×`)}">${m > 1.001 ? '▲' : m < 0.5 ? '✕' : m < 0.999 ? '▼' : ''}</td>`;
  };
  return `
    <div class="table-wrap">
      <table class="type-chart">
        <thead><tr><th class="corner">ATK ↓ / DEF →</th>${data.types.map((t) => `<th><a href="#/types/${t}" class="type type-${t.toLowerCase()}">${short(t)}</a></th>`).join('')}</tr></thead>
        <tbody>${data.types.map((atk) => `<tr><th><a href="#/types/${atk}" class="type type-${atk.toLowerCase()}">${short(atk)}</a></th>${data.types.map((def) => cell(atk, def)).join('')}</tr>`).join('')}</tbody>
      </table>
    </div>
    <p class="hint">▲ super effective (1.6×) · ▼ not very effective (0.63×) · ✕ barely works (0.39×). Pokémon GO has no
    immunities: those just take 0.39×. Two weaknesses stack to 2.56×.</p>`;
}

export function renderTypes(app, ctx, type) {
  const { data, esc, typeBadge, typeBadges, moveBadge } = ctx;
  if (!type || !data.types.includes(type)) {
    document.title = 'Type chart · Raid Boss Guide';
    app.innerHTML = `
      <section class="rotation-head"><h1>Type cheat sheet</h1>
        <p class="hint">Tap a type to see what it beats, what beats it, and the best raid attackers of that type.</p></section>
      <section class="panel">
        <div class="matchups">${data.types.map((t) => `<a href="#/types/${t}" class="type type-${t.toLowerCase()} type-pick">${t}</a>`).join('')}</div>
      </section>
      <section class="panel"><h2>Type chart</h2>${chart(ctx)}</section>`;
    return;
  }

  document.title = `${type} type · Raid Boss Guide`;
  const attacking = data.types.map((d) => ({ type: d, mult: data.typeChart[type][d] }));
  const defending = data.types.map((a) => ({ type: a, mult: effectiveness(a, [type], data.typeChart) }));
  const list = (items) => items.length
    ? `<div class="matchups">${items.map((i) => `<span class="matchup">${typeBadge(i.type)} ${multLabel(i.mult)}</span>`).join('')}</div>`
    : '<p class="hint">None.</p>';

  // Best attackers of this type (each species once), from the same rankings as the Power up? page.
  const ranking = ctx.adviceContext().rankings[type] || [];
  const seen = new Set();
  const top = [];
  for (const r of ranking) {
    const id = `${r.key}:${r.shadow}`;
    if (seen.has(id)) continue;
    seen.add(id);
    top.push(r);
    if (top.length === 10) break;
  }

  // The player's own best attackers of this type.
  const collection = ctx.getCollection();
  const yours = collection.length ? yourBest(data, collection, type) : [];

  app.innerHTML = `
    <a href="#/types" class="back">← All types</a>
    <section class="rotation-head"><h1>${typeBadge(type)} ${esc(type)}</h1></section>

    <section class="panel">
      <h2>${esc(type)} attacks are…</h2>
      <h3>Super effective against</h3>${list(attacking.filter((i) => i.mult > 1.001))}
      <h3>Not very effective against</h3>${list(attacking.filter((i) => i.mult < 0.999).sort((a, b) => a.mult - b.mult))}
    </section>

    <section class="panel">
      <h2>${esc(type)} Pokémon are…</h2>
      <h3>Weak to</h3>${list(defending.filter((i) => i.mult > 1.001))}
      <h3>Resistant to</h3>${list(defending.filter((i) => i.mult < 0.999).sort((a, b) => a.mult - b.mult))}
    </section>

    <section class="panel">
      <h2>Best ${esc(type)} raid attackers</h2>
      <p class="hint">At level 40 with their best ${esc(type)} moves (Megas not included; Shadows count separately).</p>
      <ol class="movesets">${top.map((r) => {
    const p = data.pokemon[r.key];
    return `<li><a href="#/pokemon/${r.key}">${r.shadow ? 'Shadow ' : ''}${esc(p.name)}</a> ${typeBadges(p.types)}<br>
      ${moveBadge(r.fast, p.eliteFast.includes(r.fast))} + ${moveBadge(r.charged, p.eliteCharged.includes(r.charged))}</li>`;
  }).join('')}</ol>
    </section>

    <section class="panel">
      <h2>Your best ${esc(type)} attackers</h2>
      ${collection.length ? (yours.length ? `<ol class="movesets">${yours.map((r) => `<li><strong>${esc(r.name)}</strong>
        <span class="muted">CP ${r.cp} · Lv ${r.level}${r.movesUnknown ? ' · moves not checked' : ''}</span><br>
        ${moveBadge(r.fast)} + ${moveBadge(r.charged)}</li>`).join('')}</ol>`
    : `<p class="hint">None of your Pokémon have a ${esc(type)} charged move yet.</p>`)
    : '<p class="hint"><a href="#/mine">Add your Pokémon</a> to see your own best ones here.</p>'}
    </section>

    <section class="panel"><h2>Type chart</h2>${chart(ctx)}</section>`;
}

// The player's Pokémon that have a charged move of `type`, ranked against a boss that's weak to
// nothing and resists nothing (so only their own strength counts).
function yourBest(data, collection, type) {
  const withType = collection.filter((e) => e.charged.some((c) => data.moves[c]?.type === type));
  if (!withType.length) return [];
  const dummyKey = '__neutral__';
  const neutral = { ...data, pokemon: { ...data.pokemon, [dummyKey]: { types: [], atk: 200, def: 180, sta: 200, fast: [], charged: [] } } };
  const ranked = rankOwned(neutral, dummyKey, '5', withType.map((e) => ({
    ...e, charged: e.charged.filter((c) => data.moves[c]?.type === type),
  })));
  const seen = new Set();
  return ranked.filter((r) => !seen.has(r.entryId) && seen.add(r.entryId)).slice(0, 8);
}
