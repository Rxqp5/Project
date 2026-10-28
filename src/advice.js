// Power-up advice: how good each of the player's Pokémon is (or could be) for raids, and whether
// it's worth stardust. Pure functions, shared by the app and the tests.

import { attackerStats, rankMovesets, bossStats, averageBossDps, rankMaxAttackers } from './calc.js';
import { AVERAGE_IVS } from './collection.js';

const TARGET_LEVEL = 40;
// A typeless, average-bulk target, as community "best attackers by type" lists use.
const NEUTRAL = { types: [], atk: 200, def: 180, hp: 15000 };

// TM-able moves, plus any Elite move the Pokémon already knows.
function learnable(p, entry) {
  const known = entry ? [entry.fast, ...entry.charged] : [];
  return {
    fast: [...p.fast, ...p.eliteFast.filter((m) => known.includes(m))],
    charged: [...p.charged, ...p.eliteCharged.filter((m) => known.includes(m))],
  };
}

// Best attackers of each type at level 40 (non-Mega; Shadows included), scored with their best
// moveset of that type against a neutral target. Like community "best attackers by type" lists,
// both moves must be of that type, unless the Pokémon has no fast move of it.
export function typeRankings(data) {
  const lists = Object.fromEntries(data.types.map((t) => [t, []]));
  for (const [key, p] of Object.entries(data.pokemon)) {
    if (!p.released || p.mega || p.gmax || !p.fast.length || !p.charged.length) continue;
    for (const shadow of p.shadow ? [false, true] : [false]) {
      const a = attackerStats(p, { level: TARGET_LEVEL, shadow });
      const best = {};
      const fastTypes = new Set([...p.fast, ...p.eliteFast].map((f) => data.moves[f].type));
      for (const m of rankMovesets(p, a, NEUTRAL, 900 / a.def, data, { elite: true })) {
        const t = data.moves[m.charged].type;
        if (fastTypes.has(t) && data.moves[m.fast].type !== t) continue;
        if (!best[t] || m.score > best[t].score) best[t] = m;
      }
      for (const [t, m] of Object.entries(best)) lists[t].push({ key, shadow, ...m });
    }
  }
  for (const list of Object.values(lists)) list.sort((a, b) => b.score - a.score);
  return lists;
}

// Where this species (as Shadow or not) ranks for each type, best first. A rank counts each
// species once, so "#3 Dark" means only two other Pokémon beat it.
export function typeRanksFor(rankings, key, shadow) {
  const out = [];
  for (const [type, list] of Object.entries(rankings)) {
    const seen = new Set();
    let rank = 0;
    for (const r of list) {
      const id = `${r.key}:${r.shadow}`;
      if (seen.has(id)) continue;
      seen.add(id);
      rank++;
      if (r.key === key && r.shadow === shadow) {
        out.push({ type, rank, fast: r.fast, charged: r.charged });
        break;
      }
    }
  }
  return out.sort((a, b) => a.rank - b.rank);
}

// Where a Pokémon would place among all counters for a boss, at level 40 with its best moves.
export function bossPlacement(data, counters, bossKey, tier, key, { shadow = false, entry } = {}) {
  const p = data.pokemon[key];
  const bossPokemon = data.pokemon[bossKey];
  const boss = bossStats(bossPokemon, tier);
  const a = attackerStats(p, { level: TARGET_LEVEL, shadow });
  const incoming = averageBossDps(bossPokemon, boss, a, data);
  const moves = learnable(p, entry);
  const [best] = rankMovesets({ ...p, ...moves, eliteFast: [], eliteCharged: [] }, a, boss, incoming, data, { elite: false });
  if (!best) return null;
  // Compared with every other counter except Megas, which most players can't keep active.
  const field = counters.filter((c) => !c.mega && !(c.key === key && c.shadow === shadow));
  return { rank: field.filter((c) => c.score > best.score).length + 1, ...best };
}

// Stardust and candy to power up from `from` to `to`, two power-ups per level.
export function powerUpCost(data, from, to = TARGET_LEVEL, { shadow = false, purified = false, lucky = false } = {}) {
  const pu = data.powerUp;
  let dustMult = 1;
  if (shadow) dustMult *= pu.shadow;
  if (purified) dustMult *= pu.purified;
  if (lucky) dustMult *= pu.lucky;
  const candyMult = shadow ? pu.shadow : purified ? pu.purified : 1;
  let stardust = 0;
  let candy = 0;
  let xl = 0;
  for (let level = from; level < to; level += 0.5) {
    const i = Math.floor(level) - 1;
    stardust += Math.round(pu.stardust[i] * dustMult);
    if (level < pu.xlFromLevel) candy += Math.round(pu.candy[i] * candyMult);
    else xl += Math.round(pu.xlCandy[i - (pu.xlFromLevel - 1)] * candyMult);
  }
  return { stardust, candy, xl };
}

const VERDICTS = {
  power: { label: 'Power up', order: 0 },
  ready: { label: 'Raid-ready', order: 1 },
  maybe: { label: 'Only if you have spare stardust', order: 2 },
  skip: { label: "Don't power up", order: 3 },
};

// The ten best Max attackers for a Max Battle boss, as a set of keys.
export const maxTopAttackers = (data, key, tier) => new Set(rankMaxAttackers(data, key, tier).slice(0, 10).map((a) => a.key));

// Verdict for one of the player's Pokémon. `bosses` is [{ key, tier, counters }] for the raid
// bosses running now or coming up; `maxBosses` is [{ key, tier, top }] for current Max Battles,
// with `top` from maxTopAttackers.
export function adviseEntry(data, entry, { rankings, bosses, maxBosses = [] }) {
  const shadow = Boolean(entry.shadow);
  const typeRanks = typeRanksFor(rankings, entry.key, shadow).slice(0, 3);
  // Stick with the type its charged move already has when that's nearly as good (saves TMs).
  const currentTypes = entry.charged.map((c) => data.moves[c]?.type);
  const current = typeRanks.find((t) => currentTypes.includes(t.type));
  const bestType = current && current.rank <= typeRanks[0].rank + 3 ? current : typeRanks[0];
  const usefulAgainst = bosses
    .map((b) => ({ ...b, placement: bossPlacement(data, b.counters, b.key, b.tier, entry.key, { shadow, entry }) }))
    .filter((b) => b.placement && b.placement.rank <= 25)
    .sort((a, b) => a.placement.rank - b.placement.rank);
  const maxUses = entry.dynamax || entry.gmax
    ? maxBosses.filter((b) => b.top.has(entry.key) || b.top.has(`${entry.key}_GIGANTAMAX`))
    : [];

  const strong = (bestType && bestType.rank <= 10) || usefulAgainst.length > 0 || maxUses.length > 0;
  const decent = bestType && bestType.rank <= 25;
  let verdict;
  if (strong) verdict = entry.level < TARGET_LEVEL ? 'power' : 'ready';
  else verdict = decent ? 'maybe' : 'skip';

  const notes = [];
  const ivs = entry.ivs || null;
  if (ivs && ivs.atk < 10 && verdict === 'power') notes.push(`Its Attack IV is low (${ivs.atk}/15): a better one would be worth more stardust.`);
  if (bestType && (entry.fast !== bestType.fast || !entry.charged.includes(bestType.charged)) && verdict !== 'skip') {
    notes.push(`TM it to ${[entry.fast !== bestType.fast && data.moves[bestType.fast].name, !entry.charged.includes(bestType.charged) && data.moves[bestType.charged].name].filter(Boolean).join(' + ')} first.`);
  }
  if (verdict === 'ready' && bestType && bestType.rank <= 3 && entry.level < 50) notes.push('One of the very best: worth XL Candy to go past level 40 if you have it.');

  return {
    entry,
    verdict,
    ...VERDICTS[verdict],
    typeRanks,
    usefulAgainst,
    maxUses,
    cost: entry.level < TARGET_LEVEL ? powerUpCost(data, entry.level, TARGET_LEVEL, { shadow }) : null,
    notes,
    ivs: ivs || AVERAGE_IVS,
  };
}

export function adviseAll(data, collection, ctx) {
  return collection
    .filter((e) => data.pokemon[e.key])
    .map((e) => adviseEntry(data, e, ctx))
    .sort((a, b) => a.order - b.order
      || (a.typeRanks[0]?.rank ?? 99) - (b.typeRanks[0]?.rank ?? 99));
}

