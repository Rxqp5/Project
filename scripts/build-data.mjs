// Builds data/game.json from public Pokémon GO data sources.
//
//   npm run build:data            # download fresh sources (cached in .cache/)
//   npm run build:data -- --cached  # reuse whatever is already in .cache/
//
// Sources:
//   - PokeMiners game master: official stats, types, moves (PvE values), Megas/Primals, weather, type chart
//   - PvPoke game master:     which Pokémon / Shadow Pokémon are actually released, and display names
//   - pogoapi.net raid list:   history of which Pokémon have appeared in 1–5 star raids
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
  raids: 'https://pogoapi.net/api/v1/raid_bosses.json',
};

// Order of attackScalar entries in the game master's typeEffective settings.
const TYPES = ['Normal', 'Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel',
  'Fire', 'Water', 'Grass', 'Electric', 'Psychic', 'Ice', 'Dragon', 'Dark', 'Fairy'];

// Megas that have never been raid bosses (obtained another way).
const MEGA_NOT_IN_RAIDS = new Set(['RAYQUAZA_MEGA']);

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

const [gm, pvpoke, raidSource] = await Promise.all([load('gm'), load('pvpoke'), load('raids')]);
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
const templates = {};
const formLists = {};
for (const { templateId, data } of gm) {
  let m = /^V(\d+)_POKEMON_(.+)$/.exec(templateId);
  if (m && data.pokemonSettings) templates[m[2]] = { dex: Number(m[1]), s: data.pokemonSettings };
  m = /^FORMS_V(\d+)_POKEMON_(.+)$/.exec(templateId);
  if (m && data.formSettings) formLists[m[2]] = (data.formSettings.forms || []).map((f) => f.form).filter(Boolean);
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

for (const [name, { dex, s }] of Object.entries(templates)) {
  const forms = formLists[name];
  if (forms) {
    // Species with forms: the bare template duplicates the normal form, so use the form templates.
    for (const form of forms) {
      const t = templates[form];
      if (!t) continue;
      const isNormal = form === `${name}_NORMAL`;
      addPokemon(isNormal ? name : form, dex, t.s, isNormal ? '' : form.slice(name.length + 1));
    }
    if (!forms.some((f) => templates[f])) addPokemon(name, dex, s, '');
  } else if (!Object.keys(formLists).some((base) => formLists[base].includes(name))) {
    addPokemon(name, dex, s, '');
  }
}

// A form label is noise when it's the only version of that species we kept (e.g. "Unown (A)").
const perDex = {};
for (const p of Object.values(pokemon)) if (!p.mega) perDex[p.dex] = (perDex[p.dex] || 0) + 1;
for (const p of Object.values(pokemon)) {
  if (!p.mega && perDex[p.dex] === 1) p.name = baseNames[p.dex] || p.name.replace(/ \(.*\)$/, '');
}

// ---------- Raid bosses ----------
const raids = new Map();
const addRaid = (key, tier, source) => {
  if (!pokemon[key]) return console.warn(`  ! unknown Pokémon ${key} (tier ${tier}, ${source})`);
  raids.set(`${tier}:${key}`, { key, tier });
};

const byDex = {};
for (const [key, p] of Object.entries(pokemon)) if (!p.mega) (byDex[p.dex] ||= []).push(key);
const TIER_MAP = { 1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '5', ex: '5' };

for (const group of ['previous', 'current']) {
  for (const [tier, bosses] of Object.entries(raidSource[group])) {
    if (!TIER_MAP[tier]) continue; // Megas are generated from the game master below.
    for (const b of bosses) {
      const keys = byDex[b.id] || [];
      const form = b.form.toUpperCase();
      const key = (form !== 'NORMAL' && keys.find((k) => k.endsWith(`_${form}`)))
        || keys.find((k) => !k.includes('_') || !pokemon[k].name.includes('('))
        || keys[0];
      if (key) addRaid(key, TIER_MAP[tier], 'pogoapi');
    }
  }
}

for (const [key, p] of Object.entries(pokemon)) {
  if (!p.mega || !p.released || MEGA_NOT_IN_RAIDS.has(key)) continue;
  addRaid(key, p.mega === 'primal' ? 'primal' : p.legendary ? 'mega_legendary' : 'mega', 'game master');
}

for (const r of extra.bosses || []) addRaid(r.key, String(r.tier), 'raids-extra.json');

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
