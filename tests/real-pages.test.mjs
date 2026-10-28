import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseScreen, mergeScreens, readPokemon } from '../src/scan.js';

const data = JSON.parse(readFileSync(new URL('../data/game.json', import.meta.url)));
// What the app's text reader got from 8 real iPhone screenshots: 4 Pokémon, each the top of its
// page and then its moves. Location and account details are removed.
const pages = JSON.parse(readFileSync(new URL('./fixtures/pokemon-pages.json', import.meta.url)));
const results = mergeScreens(Object.keys(pages).sort().map((k) => parseScreen(pages[k].text, pages[k].band)))
  .map((p) => readPokemon(p, data));

test('eight screenshots make four Pokémon', () => {
  assert.equal(results.length, 4);
});

test('a Mega Evolved Mewtwo: pink CP, Mega stats and its Mega move', () => {
  const r = results[0];
  assert.equal(r.key, 'MEWTWO');
  assert.equal(r.cp, 7107);
  assert.equal(r.megaActive, 'MEWTWO_MEGA_Y');
  assert.equal(r.fast, 'PSYCHO_CUT_FAST');
  assert.deepEqual([...r.charged].sort(), ['FUTURE_SIGHT_PLUS', 'PSYSTRIKE', 'SHADOW_BALL']);
});

test('Zacian: CP partly hidden by its sword, perfect IVs from the power-up cost', () => {
  const r = results[1];
  assert.equal(r.key, 'ZACIAN_CROWNED_SWORD');
  assert.equal(r.cp, 5266);
  assert.deepEqual(r.ivs, { atk: 15, def: 15, sta: 15 });
  assert.ok(r.level >= 44 && r.level <= 44.5);
  assert.deepEqual(r.charged, ['BEHEMOTH_BLADE', 'CLOSE_COMBAT']);
  assert.equal(r.dynamax, true);
});

test('a nicknamed Metagross is identified from its moves; its hidden CP is asked for', () => {
  const r = results[2];
  assert.equal(r.key, 'METAGROSS');
  assert.equal(r.cp, null);
  assert.ok(r.level >= 40 && r.level <= 40.5);
  assert.equal(r.fast, 'SHADOW_CLAW_FAST');
  assert.deepEqual([...r.charged].sort(), ['EARTHQUAKE', 'FLASH_CANNON']);
  assert.equal(r.mega, true);
  assert.equal(r.dynamax, true);
});

test('a Shadow Machamp: exact level and IVs despite the Purify cost on screen', () => {
  const r = results[3];
  assert.equal(r.key, 'MACHAMP');
  assert.equal(r.cp, 2898);
  assert.equal(r.shadow, true);
  assert.equal(r.level, 37.5);
  assert.deepEqual(r.ivs, { atk: 15, def: 14, sta: 9 });
  assert.deepEqual([r.fast, ...r.charged], ['COUNTER_FAST', 'CLOSE_COMBAT']);
});
