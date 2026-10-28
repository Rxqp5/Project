import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickParty } from '../src/calc.js';
import {
  cpmAt, cpAt, estimateLevel, rankOwned, moveTips, rankOwnedMax, validEntries, loadCollection, saveCollection,
} from '../src/collection.js';

const data = JSON.parse(readFileSync(new URL('../data/game.json', import.meta.url)));
const perfect = { atk: 15, def: 15, sta: 15 };
const entry = (id, key, cp, fast, charged, extra = {}) => ({
  id, key, cp, fast, charged, level: estimateLevel(data, data.pokemon[key], cp, extra.ivs || undefined), ...extra,
});

test('CP and level maths match the game', () => {
  assert.equal(cpAt(data.pokemon.MEWTWO, cpmAt(data, 40), perfect), 4178);
  assert.equal(cpAt(data.pokemon.MEWTWO, cpmAt(data, 20), perfect), 2387);
  assert.equal(estimateLevel(data, data.pokemon.MEWTWO, 4178, perfect), 40);
  assert.equal(estimateLevel(data, data.pokemon.MEWTWO, 2984, perfect), 25);
});

const collection = [
  entry('a', 'TYRANITAR', 3200, 'BITE_FAST', ['CRUNCH']),
  entry('b', 'TYRANITAR', 2800, 'SMACK_DOWN_FAST', ['STONE_EDGE'], { shadow: true }),
  entry('c', 'GENGAR', 2500, 'LICK_FAST', ['SHADOW_BALL'], { mega: true }),
  entry('d', 'MACHAMP', 2900, 'COUNTER_FAST', ['DYNAMIC_PUNCH'], { dynamax: true }),
];

test('your team uses your own Pokémon, allows two of a species and one Mega', () => {
  const ranked = rankOwned(data, 'MEWTWO', '5', collection);
  const team = pickParty(ranked, undefined, { idOf: (c) => c.entryId });
  assert.equal(team[0].name, 'Mega Gengar');
  assert.equal(team.filter((c) => c.key === 'TYRANITAR').length, 2);
  assert.equal(team.filter((c) => c.mega).length, 1);
  assert.equal(new Set(team.map((c) => c.entryId)).size, team.length);
});

test('TM tips point at better moves', () => {
  const ranked = rankOwned(data, 'MEWTWO', '5', collection);
  const tips = moveTips(ranked, pickParty(ranked, undefined, { idOf: (c) => c.entryId }));
  const shadowTtar = tips.find((t) => t.entryId === 'b');
  assert.equal(shadowTtar.newFast, 'BITE_FAST');
  assert.equal(shadowTtar.newCharged, 'BRUTAL_SWING');
  assert.ok(shadowTtar.gain > 0.5);
});

test('Max team only uses Pokémon marked Dynamax', () => {
  const { attackers } = rankOwnedMax(data, 'MACHOP', 'max_2', collection);
  assert.deepEqual(attackers.map((a) => a.entryId), ['d']);
});

test('backups round-trip and bad entries are dropped', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.ok(saveCollection(storage, collection));
  assert.deepEqual(loadCollection(storage), collection);
  const cleaned = validEntries(data, [...collection, { key: 'NOT_A_POKEMON' }, null, { ...collection[0], fast: 'NOPE' }]);
  assert.equal(cleaned.length, collection.length);
});
