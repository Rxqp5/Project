// Builds data/game.json from public Pokémon GO data sources.
//
//   npm run build:data            # download fresh sources (cached in .cache/)
//   npm run build:data -- --cached  # reuse whatever is already in .cache/
//
// Sources:
//   - PokeMiners game master: official stats, types, moves (PvE values), Megas/Primals, weather, type chart
//   - PvPoke game master:     which Pokémon / Shadow Pokémon are actually released, and display names
//   - Pokebattler raid list:   current, upcoming and past bosses for every raid tier (incl. Super Mega, Shadow)
//   - Pokebattler Pokémon/moves: newer Megas and moves the game master doesn't have yet
//   - pogoapi.net raid list:   older raid history (last updated November 2025), merged in as past bosses
// Bosses added by hand live in data/raids-extra.json and are merged in last.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const cacheDir = `${root}.cache/`;
const useCache = process.argv.includes('--cached');

const SOURCES = {
  gm: 'https://raw.githubusercontent.com/PokeMiners/game_masters/master/latest/latest.json',
  pvpoke: 'https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/gamemaster.min.json',
  pokebattler: 'https://fight.pokebattler.com/raids',
  pokebattlerPokemon: 'https://fight.pokebattler.com/pokemon',
  pokebattlerMoves: 'https://fight.pokebattler.com/moves',
  raids: 'https://pogoapi.net/api/v1/raid_bosses.json',
};

// Order of attackScalar entries in the game master's typeEffective settings.
const TYPES = ['Normal', 'Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel',
  'Fire', 'Water', 'Grass', 'Electric', 'Psychic', 'Ice', 'Dragon', 'Dark', 'Fairy'];

// Moves that are never useful in raids and only exist for Shadow/Purified Pokémon.
const SKIP_MOVES = new Set(['FRUSTRATION', 'RETURN']);

async function load(name) {
  const file = `${cacheDir}${name}.json`;
  if (!useCache || !existsSync(file)) {
    console.log(`Downloading ${name}…`);
    const res = await fetch(SOURCES[name]);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, await res.text());
  }
  return JSON.parse(await readFile(file, 'utf8'));
}

const typeName = (t) => t && t.replace('POKEMON_TYPE_', '').toLowerCase().replace(/^./, (c) => c.toUpperCase());
const titleCase = (s) => s.toLowerCase().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

const [gm, pvpoke, pokebattler, pbPokemon, pbMoves, raidSource] = await Promise.all(
  ['gm', 'pvpoke', 'pokebattler', 'pokebattlerPokemon', 'pokebattlerMoves', 'raids'].map(load));
const extra = JSON.parse(await readFile(`${root}data/raids-extra.json`, 'utf8'));

// ---------- Type chart & weather ----------
const typeChart = {};
for (const { data } of gm) {
  if (!data.typeEffective) continue;
  const atk = typeName(data.typeEffective.attackType);
  typeChart[atk] = Object.fromEntries(TYPES.map((def, i) => [def, data.typeEffective.attackScalar[i]]));
}
const weather = {};
for (const { data } of gm) {
  if (!data.weatherAffinities) continue;
  weather[titleCase(data.weatherAffinities.weatherCondition)] = data.weatherAffinities.pokemonType.map(typeName);
}

// ---------- Moves ----------
const moves = {};
const moveByNumber = {};
for (const { templateId, data } of gm) {
  const m = /^V(\d+)_MOVE_(.+)$/.exec(templateId);
  if (!m || !data.moveSettings) continue;
  const s = data.moveSettings;
  const id = m[2];
  const fast = id.endsWith('_FAST');
  moveByNumber[Number(m[1])] = id;
  moves[id] = {
    name: id.replace(/_FAST$/, ''), // replaced with PvPoke's display name below when available
    type: typeName(s.pokemonType),
    kind: fast ? 'fast' : 'charged',
    power: s.power || 0,
    duration: s.durationMs,
    // Fast moves gain energy; charged moves cost energy (stored as a positive number).
    energy: Math.abs(s.energyDelta || 0),
  };
}
const moveId = (m) => (typeof m === 'number' ? moveByNumber[m] : m);
const moveList = (list = []) => list.map(moveId).filter((id) => id && moves[id] && !SKIP_MOVES.has(id));

// ---------- Release status & names from PvPoke ----------
const statKey = (dex, atk, def, hp) => `${dex}:${atk}:${def}:${hp}`;
const released = new Set();
const releasedShadow = new Set();
const baseNames = {};
for (const m of pvpoke.moves) {
  const id = moves[`${m.moveId}_FAST`] ? `${m.moveId}_FAST` : m.moveId;
  if (moves[id] && moves[id].name === id.replace(/_FAST$/, '')) moves[id].name = m.name;
}
// Moves added since the game master's last update.
for (const m of pbMoves.move) {
  if (!m.moveId || moves[m.moveId] || !m.durationMs || !m.type) continue;
  moves[m.moveId] = {
    name: titleCase(m.moveId.replace(/_FAST$/, '').replace(/_PLUS$/, '+')).replace(/ \+$/, '+'),
    type: typeName(m.type),
    kind: m.moveId.endsWith('_FAST') ? 'fast' : 'charged',
    power: m.power || 0,
    duration: m.durationMs,
    energy: Math.abs(m.energyDelta || 0),
  };
}
const MOVE_NAMES = { FUTURESIGHT: 'Future Sight' };
for (const [id, m] of Object.entries(moves)) {
  if (MOVE_NAMES[id]) m.name = MOVE_NAMES[id];
  else if (/^[A-Z0-9_]+$/.test(m.name)) m.name = titleCase(m.name);
}
for (const p of pvpoke.pokemon) {
  const key = statKey(p.dex, p.baseStats.atk, p.baseStats.def, p.baseStats.hp);
  if (p.released !== false) released.add(key);
  if (p.speciesId.endsWith('_shadow') && p.released !== false) releasedShadow.add(key);
  if (!p.speciesName.includes('(') && !/^(Mega|Primal) /.test(p.speciesName) && !baseNames[p.dex]) {
    baseNames[p.dex] = p.speciesName;
  }
}

// ---------- Pokémon ----------
// Keyed by "dex:NAME": form names aren't unique on their own (both Nidorans have NIDORAN_NORMAL).
const templates = {};
const formLists = {};
for (const { templateId, data } of gm) {
  let m = /^V(\d+)_POKEMON_(.+)$/.exec(templateId);
  if (m && data.pokemonSettings) templates[`${Number(m[1])}:${m[2]}`] = { dex: Number(m[1]), name: m[2], s: data.pokemonSettings };
  m = /^FORMS_V(\d+)_POKEMON_(.+)$/.exec(templateId);
  if (m && data.formSettings) {
    formLists[`${Number(m[1])}:${m[2]}`] = (data.formSettings.forms || []).map((f) => f.form).filter(Boolean);
  }
}

const pokemon = {};
const fingerprints = new Set();

function addPokemon(key, dex, s, form) {
  if (!s.stats?.baseAttack || !s.type) return;
  const types = [typeName(s.type), typeName(s.type2)].filter(Boolean);
  const { baseAttack: atk, baseDefense: def, baseStamina: sta } = s.stats;
  const fast = moveList(s.quickMoves);
  const charged = moveList([...(s.cinematicMoves || []), ...(s.nonTmCinematicMoves || [])]);
  const eliteFast = moveList(s.eliteQuickMove);
  const eliteCharged = moveList(s.eliteCinematicMove);
  // Costume and cosmetic forms share stats/moves with the normal form; keep just one.
  const fp = JSON.stringify([dex, types, atk, def, sta, [...fast].sort(), [...charged].sort()]);
  if (fingerprints.has(fp)) return;
  fingerprints.add(fp);

  const species = baseNames[dex] || titleCase(s.pokemonId);
  const formLabel = form ? titleCase(form) : '';
  const sk = statKey(dex, atk, def, sta);
  const entry = {
    dex,
    name: formLabel ? `${species} (${formLabel})` : species,
    types, atk, def, sta,
    fast, charged, eliteFast, eliteCharged,
    legendary: s.pokemonClass ? titleCase(s.pokemonClass.replace('POKEMON_CLASS_', '')) : undefined,
    released: released.has(sk),
    shadow: Boolean(s.shadow) && releasedShadow.has(sk),
  };
  pokemon[key] = entry;

  for (const o of s.tempEvoOverrides || []) {
    if (!o.stats?.baseAttack) continue;
    const evo = o.tempEvoId.replace('TEMP_EVOLUTION_', ''); // MEGA, MEGA_X, MEGA_Y, PRIMAL
    const megaKey = `${key}_${evo}`;
    const [prefix, suffix] = evo === 'PRIMAL' ? ['Primal', ''] : ['Mega', evo.replace(/^MEGA_?/, '')];
    const { baseAttack: matk, baseDefense: mdef, baseStamina: msta } = o.stats;
    pokemon[megaKey] = {
      ...entry,
      name: `${prefix} ${species}${suffix ? ` ${suffix}` : ''}`,
      types: [typeName(o.typeOverride1), typeName(o.typeOverride2)].filter(Boolean),
      atk: matk, def: mdef, sta: msta,
      released: released.has(statKey(dex, matk, mdef, msta)),
      shadow: false,
      mega: evo === 'PRIMAL' ? 'primal' : 'mega',
      base: key,
    };
  }
}

const formTemplates = new Set(Object.values(formLists).flat().map(String));
for (const [id, { dex, name, s }] of Object.entries(templates)) {
  const forms = formLists[id];
  if (forms) {
    // Species with forms: the bare template duplicates the normal form, so use the form templates.
    // The normal form's name can differ from the species (NIDORAN_FEMALE -> NIDORAN_NORMAL).
    const formTail = (f) => f.slice(f.lastIndexOf(name) === 0 ? name.length + 1 : f.indexOf('_') + 1);
    for (const form of forms) {
      const t = templates[`${dex}:${form}`];
      if (!t) continue;
      const isNormal = form.endsWith('_NORMAL');
      addPokemon(isNormal ? s.pokemonId : form, dex, t.s, isNormal ? '' : formTail(form));
    }
    if (!forms.some((f) => templates[`${dex}:${f}`])) addPokemon(s.pokemonId, dex, s, '');
  } else if (!formTemplates.has(name)) {
    addPokemon(s.pokemonId, dex, s, '');
  }
}

// A form label is noise when it's the only version of that species we kept (e.g. "Unown (A)").
const perDex = {};
for (const p of Object.values(pokemon)) if (!p.mega) perDex[p.dex] = (perDex[p.dex] || 0) + 1;
for (const p of Object.values(pokemon)) {
  if (!p.mega && perDex[p.dex] === 1) p.name = baseNames[p.dex] || p.name.replace(/ \(.*\)$/, '');
}

// The game master can lag behind new Megas; fill the gaps from Pokebattler's Pokémon data.
const knownStats = new Set(Object.values(pokemon).map((p) => statKey(p.dex, p.atk, p.def, p.sta)));
for (const pb of pbPokemon.pokemon) {
  const m = /^(.+?)_(MEGA(?:_[A-Z]+)?|PRIMAL)$/.exec(pb.pokemonId);
  const dex = pb.pokedex?.pokemonNum;
  if (!m || !dex || !pb.stats?.baseAttack || pokemon[pb.pokemonId]) continue;
  const { baseAttack: atk, baseDefense: def, baseStamina: sta } = pb.stats;
  if (knownStats.has(statKey(dex, atk, def, sta))) continue; // same Mega under another id
  knownStats.add(statKey(dex, atk, def, sta));
  const baseKey = pokemon[m[1]] ? m[1] : Object.keys(pokemon).find((k) => pokemon[k].dex === dex && !pokemon[k].mega);
  if (!baseKey) continue;
  const base = pokemon[baseKey];
  const species = baseNames[dex] || base.name.replace(/ \(.*\)$/, '');
  const suffix = m[2].replace(/^MEGA_?/, '');
  pokemon[pb.pokemonId] = {
    ...base,
    name: m[2] === 'PRIMAL' ? `Primal ${species}`
      : `Mega ${species}${suffix.length === 1 ? ` ${suffix}` : suffix ? ` (${titleCase(suffix)})` : ''}`,
    types: [typeName(pb.type), typeName(pb.type2)].filter(Boolean),
    atk, def, sta,
    fast: moveList(pb.quickMoves),
    charged: moveList(pb.cinematicMoves),
    eliteFast: moveList(pb.eliteQuickMove || []),
    eliteCharged: moveList(pb.eliteCinematicMove || []),
    released: released.has(statKey(dex, atk, def, sta)),
    shadow: false,
    mega: m[2] === 'PRIMAL' ? 'primal' : 'mega',
    base: baseKey,
  };
}

// ---------- Raid bosses ----------
// status: "current" (in raids now), "upcoming" (announced), "past", or "future"
// (Pokebattler's list of Pokémon that could plausibly become this kind of boss one day).
const STATUS_RANK = { current: 4, upcoming: 3, past: 2, future: 1 };
const raids = new Map();
const addRaid = (key, tier, status, source, more = {}) => {
  if (!pokemon[key]) return console.warn(`  ! unknown Pokémon ${key} (tier ${tier}, ${source})`);
  const id = `${tier}:${key}`;
  const raid = raids.get(id) || { key, tier, status };
  if (STATUS_RANK[status] > STATUS_RANK[raid.status]) raid.status = status;
  raids.set(id, Object.assign(raid, more));
};

// Pokebattler ids look like GIRATINA_ALTERED_FORM, TORNADUS_SHADOW_FORM, ABSOL_MEGA_Z.
// Cosmetic forms we merged (UNOWN_B, SHELLOS_EAST_SEA) fall back to the species by trimming the form.
function resolveKey(id) {
  let k = id.replace(/_FORM$/, '').replace(/_SHADOW$/, '').replace('_SHADOW_', '_').replace(/_NORMAL$/, '');
  for (;;) {
    if (pokemon[k]) return k;
    const sameSpecies = Object.keys(pokemon).find((p) => p.startsWith(`${k}_`) && !pokemon[p].mega);
    if (sameSpecies) return sameSpecies;
    if (/MEGA|PRIMAL/.test(k) || !k.includes('_')) return id;
    k = k.slice(0, k.lastIndexOf('_'));
  }
}

const PB_TIERS = {
  RAID_LEVEL_1: '1', RAID_LEVEL_2: '2', RAID_LEVEL_3: '3', RAID_LEVEL_4: '4', RAID_LEVEL_4_EVENTS: '4',
  RAID_LEVEL_5: '5', RAID_LEVEL_6: '5', RAID_LEVEL_ULTRA_BEAST: '5', RAID_LEVEL_ELITE: 'elite',
  RAID_LEVEL_MEGA: 'mega', RAID_LEVEL_MEGA_5: 'mega_legendary',
  RAID_LEVEL_4_MEGA_ENHANCED: 'super_mega_4', RAID_LEVEL_5_MEGA_ENHANCED: 'super_mega_5',
  RAID_LEVEL_1_SHADOW: 'shadow_1', RAID_LEVEL_3_SHADOW: 'shadow_3', RAID_LEVEL_5_SHADOW: 'shadow_5',
};
for (const { tier: pbTier, raids: bosses } of pokebattler.tiers) {
  const [, base, suffix] = /^(.*?)(_LEGACY|_FUTURE)?$/.exec(pbTier);
  const tier = PB_TIERS[base];
  if (!tier) continue; // Max Battles and placeholder tiers
  for (const b of bosses) {
    const key = resolveKey(b.pokemon);
    const t = tier === 'mega_legendary' && pokemon[key]?.mega === 'primal' ? 'primal' : tier;
    const status = suffix === '_LEGACY' ? 'past' : suffix === '_FUTURE' ? 'future' : b.upcoming ? 'upcoming' : 'current';
    addRaid(key, t, status, 'pokebattler', b.startDate ? { start: b.startDate } : {});
  }
}

const byDex = {};
for (const [key, p] of Object.entries(pokemon)) if (!p.mega) (byDex[p.dex] ||= []).push(key);
const POGOAPI_TIERS = { 1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '5', ex: '5' };
for (const group of ['previous', 'current']) {
  for (const [tier, bosses] of Object.entries(raidSource[group])) {
    if (!POGOAPI_TIERS[tier]) continue; // Pokebattler covers Megas better
    for (const b of bosses) {
      const keys = byDex[b.id] || [];
      const form = b.form.toUpperCase();
      const key = (form !== 'NORMAL' && keys.find((k) => k.endsWith(`_${form}`)))
        || keys.find((k) => !k.includes('_') || !pokemon[k].name.includes('('))
        || keys[0];
      // pogoapi stopped updating in November 2025, so treat everything there as past.
      if (key) addRaid(key, POGOAPI_TIERS[tier], 'past', 'pogoapi');
    }
  }
}

for (const r of extra.bosses || []) {
  addRaid(r.key, String(r.tier), r.status || 'past', 'raids-extra.json', r.shields ? { shields: r.shields } : {});
}

const output = {
  generated: new Date().toISOString(),
  types: TYPES,
  typeChart,
  weather,
  moves,
  pokemon,
  raids: [...raids.values()],
};
await writeFile(`${root}data/game.json`, JSON.stringify(output));
console.log(`Wrote data/game.json: ${Object.keys(pokemon).length} Pokémon, ${Object.keys(moves).length} moves, ${raids.size} raid bosses.`);
