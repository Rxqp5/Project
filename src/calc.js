// Raid battle maths. Pure functions, shared by the app and the tests.
//
// Counters are ranked the way most community calculators do it (GamePress-style "DPS³ × TDO"):
// each attacker's best moveset is simulated against the boss with the PvE damage formula,
// taking into account type effectiveness, STAB, weather boost and how hard the boss hits back.

export const CPM = { 20: 0.5974, 25: 0.667934, 40: 0.7903, 50: 0.84029999, 51: 0.84529999 };

// HP and CP multiplier for each raid tier. `time` is the raid timer in seconds.
export const TIERS = {
  1: { label: '1-Star', hp: 600, cpm: 0.5974, time: 180 },
  2: { label: '2-Star', hp: 1800, cpm: 0.6700, time: 180 },
  3: { label: '3-Star', hp: 3600, cpm: 0.7300, time: 180 },
  4: { label: '4-Star', hp: 9000, cpm: 0.7900, time: 180 },
  5: { label: '5-Star', hp: 15000, cpm: 0.7900, time: 300 },
  elite: { label: 'Elite', hp: 20000, cpm: 0.9850, time: 300 },
  mega: { label: 'Mega', hp: 9000, cpm: 0.7900, time: 300 },
  mega_legendary: { label: 'Mega Legendary', hp: 22500, cpm: 0.7900, time: 300 },
  primal: { label: 'Primal', hp: 22500, cpm: 0.7900, time: 300 },
  // Super Mega raids: the boss starts with shields that only Mega-Evolved Pokémon can break.
  super_mega_4: { label: 'Super Mega ★4', hp: 25000, cpm: 0.7900, time: 300, superMega: true, shields: 8 },
  super_mega_5: { label: 'Super Mega ★5', hp: 25000, cpm: 0.7900, time: 300, superMega: true, shields: 8 },
  shadow_1: { label: 'Shadow 1-Star', hp: 600, cpm: 0.5974, time: 180, shadow: true },
  shadow_3: { label: 'Shadow 3-Star', hp: 4000, cpm: 0.7600, time: 180, shadow: true },
  shadow_5: { label: 'Shadow 5-Star', hp: 15000, cpm: 0.8200, time: 300, shadow: true },
};

// While a Super Mega boss's shields are up it hits harder and takes far less damage.
export const SHIELD_ATK = 2;
export const SHIELD_DEF = 4;

export const STAB = 1.2;
export const WEATHER_BOOST = 1.2;
export const SHADOW_ATK = 1.2;
export const SHADOW_DEF = 0.8333333;
const BOSS_MOVE_DELAY = 2000; // raid bosses pause ~2s between attacks

export function effectiveness(attackType, defTypes, chart) {
  return defTypes.reduce((m, t) => m * chart[attackType][t], 1);
}

// Every attacking type, with its multiplier against `defTypes`, strongest first.
export function matchups(defTypes, data) {
  return data.types
    .map((type) => ({ type, mult: effectiveness(type, defTypes, data.typeChart) }))
    .sort((a, b) => b.mult - a.mult);
}

export function boostedWeather(types, data) {
  return Object.entries(data.weather).filter(([, ts]) => ts.some((t) => types.includes(t))).map(([w]) => w);
}

export function cp(p, level, iv = 15) {
  const m = CPM[level];
  return Math.max(10, Math.floor(((p.atk + iv) * Math.sqrt(p.def + iv) * Math.sqrt(p.sta + iv) * m * m) / 10));
}

export function bossStats(p, tier) {
  const t = TIERS[tier];
  return {
    types: p.types,
    atk: (p.atk + 15) * t.cpm,
    def: (p.def + 15) * t.cpm,
    hp: t.hp,
    cp: Math.floor(((p.atk + 15) * Math.sqrt(p.def + 15) * Math.sqrt(t.hp)) / 10),
  };
}

// The CP range you can catch the boss at (level 20, or 25 when weather boosted), IVs 10–15.
export function catchCP(p, boosted = false) {
  const level = boosted ? 25 : 20;
  return { min: cp(p, level, 10), max: cp(p, level, 15) };
}

export function attackerStats(p, { level = 40, shadow = false } = {}) {
  const m = CPM[level];
  return {
    types: p.types,
    atk: (p.atk + 15) * m * (shadow ? SHADOW_ATK : 1),
    def: (p.def + 15) * m * (shadow ? SHADOW_DEF : 1),
    hp: Math.floor((p.sta + 15) * m),
  };
}

export function damage(move, attacker, defender, data, weather) {
  let mult = effectiveness(move.type, defender.types, data.typeChart);
  if (attacker.types.includes(move.type)) mult *= STAB;
  if (weather && data.weather[weather]?.includes(move.type)) mult *= WEATHER_BOOST;
  return Math.floor(0.5 * move.power * (attacker.atk / defender.def) * mult) + 1;
}

// Average damage per second the boss deals to `target` using one fast + charged move pair.
export function bossDps(boss, fast, charged, target, data, weather) {
  const fd = damage(fast, boss, target, data, weather);
  const cd = damage(charged, boss, target, data, weather);
  const fastUses = charged.energy / Math.max(fast.energy, 1);
  const dmg = fastUses * fd + cd;
  const time = fastUses * (fast.duration + BOSS_MOVE_DELAY) + charged.duration + BOSS_MOVE_DELAY;
  return (dmg / time) * 1000;
}

// Incoming DPS averaged over every moveset the boss could have (or the one picked).
export function averageBossDps(bossPokemon, boss, target, data, weather, bossMoves) {
  const pairs = bossMoves
    ? [bossMoves]
    : bossPokemon.fast.flatMap((f) => bossPokemon.charged.map((c) => [f, c]));
  if (!pairs.length) return 900 / target.def;
  const total = pairs.reduce(
    (sum, [f, c]) => sum + bossDps(boss, data.moves[f], data.moves[c], target, data, weather), 0);
  return total / pairs.length;
}

// GamePress PvE formula: DPS and total damage output (TDO) of a moveset before fainting,
// accounting for energy gained from damage taken.
export function movesetPerformance(attacker, fast, charged, defender, incomingDps, data, weather) {
  const fDmg = damage(fast, attacker, defender, data, weather);
  const cDmg = damage(charged, attacker, defender, data, weather);
  const fDur = fast.duration / 1000;
  const cDur = charged.duration / 1000;
  const fdps = fDmg / fDur;
  const feps = fast.energy / fDur;
  const cdps = cDmg / cDur;
  const ceps = charged.energy / cDur;
  const y = incomingDps;
  const hp = attacker.hp;
  const x = 0.5 * charged.energy + 0.5 * fast.energy;

  let dps = fdps;
  if (cdps > fdps && feps > 0) {
    const dps0 = (fdps * ceps + cdps * feps) / (ceps + feps);
    dps = Math.max(fdps, dps0 + ((cdps - fdps) / (ceps + feps)) * (0.5 - x / hp) * y);
  }
  const tdo = dps * (hp / y);
  return { dps, tdo, score: dps ** 3 * tdo };
}

function availableMoves(p, includeElite) {
  return {
    fast: includeElite ? [...p.fast, ...p.eliteFast] : p.fast,
    charged: includeElite ? [...p.charged, ...p.eliteCharged] : p.charged,
  };
}

// All of an attacker's movesets against a defender, best first.
export function rankMovesets(p, attacker, defender, incomingDps, data, { weather, elite = true } = {}) {
  const { fast, charged } = availableMoves(p, elite);
  const results = [];
  for (const f of fast) {
    for (const c of charged) {
      const perf = movesetPerformance(attacker, data.moves[f], data.moves[c], defender, incomingDps, data, weather);
      results.push({
        fast: f, charged: c, ...perf,
        elite: p.eliteFast.includes(f) || p.eliteCharged.includes(c),
      });
    }
  }
  return results.sort((a, b) => b.score - a.score);
}

// A typeless, average-bulk target used to rate a Pokémon's movesets in general.
const NEUTRAL_TARGET = { types: [], atk: 200, def: 180, hp: 15000 };

export function bestMovesetsOverall(p, data, opts = {}) {
  const attacker = attackerStats(p, opts);
  return rankMovesets(p, attacker, NEUTRAL_TARGET, 900 / attacker.def, data, opts);
}

export function isLegendary(p) {
  return Boolean(p.legendary);
}

// Every released attacker (plus Shadow variants) ranked against the boss.
export function rankCounters(data, bossKey, tier, opts = {}) {
  const { level = 40, weather, elite = true, megas = true, shadows = true, legendaries = true, bossMoves } = opts;
  const bossPokemon = data.pokemon[bossKey];
  const boss = bossStats(bossPokemon, tier);
  const results = [];

  for (const [key, p] of Object.entries(data.pokemon)) {
    if (!p.released || !p.fast.length || !p.charged.length) continue;
    if (p.mega && !megas) continue;
    if (isLegendary(p) && !legendaries) continue;
    for (const shadow of p.shadow && shadows ? [false, true] : [false]) {
      const attacker = attackerStats(p, { level, shadow });
      const incoming = averageBossDps(bossPokemon, boss, attacker, data, weather, bossMoves);
      const [best] = rankMovesets(p, attacker, boss, incoming, data, { weather, elite });
      if (!best) continue;
      results.push({
        key, shadow, dex: p.dex,
        name: shadow ? `Shadow ${p.name}` : p.name,
        types: p.types,
        mega: p.mega,
        legendary: isLegendary(p),
        ...best,
      });
    }
  }
  results.sort((a, b) => b.score - a.score);
  const top = results[0]?.score || 1;
  for (const r of results) r.rating = Math.round(100 * (r.score / top) ** 0.25);
  return results;
}

// Only true Mega Evolutions break Super Mega shields; Primal Reversion doesn't count.
export const canBreakShields = (c) => c.mega === 'mega';

// Six different species, at most one Mega/Primal (only one can be active at a time).
// With `requireMega`, the best shield-breaking Mega that passes the filter leads the team.
export function pickParty(counters, filter = () => true, { size = 6, requireMega = false } = {}) {
  const party = [];
  const dexUsed = new Set();
  let megaUsed = false;
  const leader = requireMega && counters.find((c) => canBreakShields(c) && filter(c, true));
  if (leader) {
    party.push(leader);
    dexUsed.add(leader.dex);
    megaUsed = true;
  }
  for (const c of counters) {
    if (!filter(c) || dexUsed.has(c.dex) || (c.mega && megaUsed)) continue;
    party.push(c);
    dexUsed.add(c.dex);
    if (c.mega) megaUsed = true;
    if (party.length === size) break;
  }
  return party;
}

// `asLeader` lets a budget team still bring the Mega a Super Mega raid demands, as long as
// it isn't a Legendary.
export const budgetFilter = (c, asLeader = false) => (asLeader ? !c.legendary : !c.mega && !c.shadow && !c.legendary);

// Rough number of trainers needed with this party. Assumes ~80% of the timer is spent attacking.
// Super Mega raids also need one Mega-wielding trainer per shield.
export function trainersNeeded(party, tier, shields = TIERS[tier].shields) {
  if (!party.length) return null;
  const t = TIERS[tier];
  const avgDps = party.reduce((s, c) => s + c.dps, 0) / party.length;
  const perTrainer = avgDps * t.time * 0.8;
  const byDamage = Math.max(1, Math.ceil(t.hp / perTrainer));
  return t.superMega ? Math.max(byDamage, shields) : byDamage;
}
