// The player's own Pokémon ("My Pokémon"): working out levels from CP, and ranking the
// collection against a boss. Pure functions, shared by the app and the tests.
//
// A collection entry looks like:
//   { id, key, cp, level, ivs: { atk, def, sta } | null, fast, charged: [id, id?],
//     shadow, mega, dynamax, gmax, movesUnknown }
// `mega` means the player can Mega Evolve it; `dynamax`/`gmax` that it can join Max Battles.
// `movesUnknown` marks a storage import, given its best moves until its own page is scanned.

import {
  SHADOW_ATK, SHADOW_DEF, bossStats, averageBossDps, movesetPerformance, rankMovesets, bestMaxMove,
} from './calc.js';

// Used when the player doesn't know the IVs: a typical caught/raided Pokémon.
export const AVERAGE_IVS = { atk: 12, def: 12, sta: 12 };
export const MAX_LEVEL = 51;

// CP multiplier at any level from 1 to 51, including half levels.
export function cpmAt(data, level) {
  const whole = Math.floor(level);
  const a = data.cpm[whole - 1];
  if (level === whole) return a;
  const b = data.cpm[whole];
  return Math.sqrt((a * a + b * b) / 2);
}

export function cpAt(p, cpm, ivs) {
  const cp = (p.atk + ivs.atk) * Math.sqrt(p.def + ivs.def) * Math.sqrt(p.sta + ivs.sta) * cpm * cpm / 10;
  return Math.max(10, Math.floor(cp));
}

// The level whose CP is closest to `cp` (the lower level on a tie).
export function estimateLevel(data, p, cp, ivs = AVERAGE_IVS) {
  let best = 1;
  let bestDiff = Infinity;
  for (let level = 1; level <= MAX_LEVEL; level += 0.5) {
    const diff = Math.abs(cpAt(p, cpmAt(data, level), ivs) - cp);
    if (diff < bestDiff) {
      best = level;
      bestDiff = diff;
    }
  }
  return best;
}

export function ownedStats(data, entry, p) {
  const m = cpmAt(data, entry.level);
  const ivs = entry.ivs || AVERAGE_IVS;
  return {
    types: p.types,
    atk: (p.atk + ivs.atk) * m * (entry.shadow ? SHADOW_ATK : 1),
    def: (p.def + ivs.def) * m * (entry.shadow ? SHADOW_DEF : 1),
    hp: Math.floor((p.sta + ivs.sta) * m),
  };
}

const ownedName = (entry, p) => (entry.shadow ? `Shadow ${p.name}` : p.name);

// Each entry as it can fight in a raid: as itself and, if the player can Mega Evolve it, as
// each of its released Megas (same level and IVs).
function raidForms(data, entry) {
  const base = data.pokemon[entry.key];
  if (!base) return [];
  const forms = [{ key: entry.key, p: base }];
  if (entry.mega) {
    for (const [key, p] of Object.entries(data.pokemon)) {
      if (p.base === entry.key && p.mega && p.released) forms.push({ key, p });
    }
  }
  return forms;
}

// The player's Pokémon ranked against a boss with the moves they actually have. Each result
// also carries the best moveset that species could learn, for TM suggestions.
export function rankOwned(data, bossKey, tier, collection, { weather, bossMoves } = {}) {
  const bossPokemon = data.pokemon[bossKey];
  const boss = bossStats(bossPokemon, tier);
  const results = [];
  for (const entry of collection) {
    for (const { key, p } of raidForms(data, entry)) {
      const attacker = ownedStats(data, entry, p);
      const incoming = averageBossDps(bossPokemon, boss, attacker, data, weather, bossMoves);
      let best;
      for (const c of entry.charged.filter(Boolean)) {
        if (!data.moves[entry.fast] || !data.moves[c]) continue;
        const perf = movesetPerformance(attacker, data.moves[entry.fast], data.moves[c], boss, incoming, data, weather);
        if (!best || perf.score > best.score) best = { charged: c, ...perf };
      }
      if (!best) continue;
      const [ideal] = rankMovesets(p, attacker, boss, incoming, data, { weather, elite: true });
      results.push({
        entryId: entry.id, key, dex: p.dex, types: p.types, mega: p.mega, legendary: Boolean(p.legendary),
        movesUnknown: Boolean(entry.movesUnknown),
        shadow: Boolean(entry.shadow), level: entry.level, cp: entry.cp,
        name: ownedName(entry, p),
        fast: entry.fast, ...best,
        ideal,
      });
    }
  }
  return results.sort((a, b) => b.score - a.score);
}

// "TM it to …" tips: team members whose moves fall well short of their best, and Pokémon left
// out of the team that would beat its weakest member with better moves.
export function moveTips(ranked, team, minGain = 0.1) {
  const inTeam = new Set(team.map((t) => t.entryId));
  const weakest = Math.min(...team.map((t) => t.dps));
  const seen = new Set();
  const tips = [];
  for (const r of ranked) {
    // Assumed moves (storage imports) are already its best, so there's nothing to suggest.
    if (!r.ideal || r.movesUnknown || seen.has(r.entryId)) continue;
    seen.add(r.entryId);
    const gain = r.ideal.dps / r.dps - 1;
    if (gain < minGain || (!inTeam.has(r.entryId) && r.ideal.dps <= weakest)) continue;
    tips.push({
      ...r,
      gain,
      newFast: r.ideal.fast !== r.fast ? r.ideal.fast : null,
      newCharged: r.ideal.charged !== r.charged ? r.ideal.charged : null,
      elite: r.ideal.elite,
      inTeam: inTeam.has(r.entryId),
    });
  }
  return tips;
}

// The player's Dynamax/Gigantamax Pokémon for Max Battles: attackers by Max Attack damage and
// tanks by how long they survive.
export function rankOwnedMax(data, bossKey, tier, collection, { weather, bossMoves } = {}) {
  const bossPokemon = data.pokemon[bossKey];
  const boss = bossStats(bossPokemon, tier);
  const attackers = [];
  const tanks = [];
  for (const entry of collection) {
    if (!entry.dynamax && !entry.gmax) continue;
    const key = entry.gmax && data.pokemon[`${entry.key}_GIGANTAMAX`] ? `${entry.key}_GIGANTAMAX` : entry.key;
    const p = data.pokemon[key];
    if (!p) continue;
    const stats = ownedStats(data, entry, p);
    const name = ownedName(entry, p);
    const common = { entryId: entry.id, key, dex: p.dex, types: p.types, name, level: entry.level, cp: entry.cp };
    const best = bestMaxMove(p, stats, [entry.fast], boss, data, weather);
    if (best) attackers.push({ ...common, gmax: Boolean(p.gmax), ...best });
    const incoming = averageBossDps(bossPokemon, boss, stats, data, weather, bossMoves);
    tanks.push({ ...common, hp: stats.hp, survival: stats.hp / incoming });
  }
  attackers.sort((a, b) => b.maxDamage - a.maxDamage || b.fastDps - a.fastDps);
  tanks.sort((a, b) => b.survival - a.survival);
  return { attackers, tanks };
}

// ---------- Saving ----------

const STORAGE_KEY = 'myPokemon';

export function loadCollection(storage) {
  try {
    const list = JSON.parse(storage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveCollection(storage, list) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

// Keeps only entries that still make sense with the current game data (e.g. after a backup import).
export function validEntries(data, list) {
  return list.filter((e) => e && typeof e === 'object' && data.pokemon[e.key] && data.moves[e.fast]
    && Array.isArray(e.charged) && e.charged.some((c) => data.moves[c]) && Number(e.level) >= 1)
    .map((e) => ({ ...e, id: e.id || crypto.randomUUID() }));
}
