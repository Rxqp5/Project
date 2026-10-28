import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseScreen, readPokemon, mergeScreens, pickCp, possibleCps, similarity } from '../src/scan.js';

const data = JSON.parse(readFileSync(new URL('../data/game.json', import.meta.url)));
// Real Tesseract output from rendered Pokémon GO-style screens (see tests/fixtures).
const fixture = (name) => readFileSync(new URL(`./fixtures/ocr-${name}.txt`, import.meta.url), 'utf8');

test('reads species, CP, moves, level and exact IVs from a screenshot', () => {
  const r = readPokemon(parseScreen(fixture('ttar')), data);
  assert.equal(r.key, 'TYRANITAR');
  assert.equal(r.cp, 3265);
  assert.equal(r.fast, 'BITE_FAST');
  assert.deepEqual(r.charged, ['CRUNCH']);
  assert.equal(r.level, 30);
  assert.deepEqual(r.ivs, { atk: 15, def: 13, sta: 14 });
  assert.deepEqual(r.problems, []);
});

test('a nicknamed Shadow Pokémon is identified from its candy and moves', () => {
  const r = readPokemon(parseScreen(fixture('gengar-nick')), data);
  assert.equal(r.key, 'GENGAR');
  assert.equal(r.shadow, true);
  assert.deepEqual(r.charged, ['SHADOW_BALL']);
});

test('Dynamax is detected from the Max Moves section', () => {
  const r = readPokemon(parseScreen(fixture('machamp-max')), data);
  assert.equal(r.key, 'MACHAMP');
  assert.equal(r.dynamax, true);
});

test('misread CP digits are corrected using HP and stardust', () => {
  // What the browser actually read for a CP 2603 Shadow Gengar.
  const text = 'CR200S\nSpooky\n129/129 HP\nGASTLY CANDY\nPOWER UP 9,600 10 PURIFY\nLick 12\nShadow Ball 70\nCP2003\ncr2603';
  const r = readPokemon(parseScreen(text), data);
  assert.equal(r.key, 'GENGAR');
  assert.equal(r.cp, 2603);
  const possible = possibleCps(data, data.pokemon.GENGAR, { hp: 129, stardust: 9600, shadow: true });
  assert.equal(pickCp(['2003', '2603', '2603'], possible).cp, 2603);
});

test('a moves-only screenshot is merged into the one before it', () => {
  const [merged, ...rest] = mergeScreens([
    parseScreen('CP 3265\nTyranitar\n174/174 HP\nLARVITAR CANDY\nPOWER UP 5,000 4'),
    parseScreen('Bite 12\nCrunch 70'),
  ]);
  assert.equal(rest.length, 0);
  const r = readPokemon(merged, data);
  assert.deepEqual([r.key, r.fast, r.charged[0]], ['TYRANITAR', 'BITE_FAST', 'CRUNCH']);
});

test('fuzzy text matching tolerates small misreads', () => {
  assert.ok(similarity('CRNCH', 'CRUNCH') > 0.8);
  assert.ok(similarity('SHAD0W BALL', 'SHADOW BALL') > 0.9);
});
