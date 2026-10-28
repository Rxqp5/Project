import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isStorageGrid, parseGrid, readGridTiles } from '../src/scan.js';

const data = JSON.parse(readFileSync(new URL('../data/game.json', import.meta.url)));
// Word positions from real storage screenshots (an iPhone, 1290px wide), read with the app's
// "dark text" pass. Nicknames are replaced with "Nick".
const { width, screens } = JSON.parse(readFileSync(new URL('./fixtures/storage-words.json', import.meta.url)));
const read = (name) => readGridTiles(parseGrid(screens[name], width), data, width);
const pairs = (drafts) => drafts.filter((d) => d.key && d.cp).map((d) => `${d.key}:${d.cp}`);

test('storage screenshots are recognised as storage', () => {
  for (const words of Object.values(screens)) assert.ok(isStorageGrid(words));
});

test('names and CPs are paired per tile, ignoring sprite noise and cut-off tiles', () => {
  const found = pairs(read('storage-1'));
  for (const p of ['AGGRON:3045', 'GYARADOS:3040', 'HATTERENE:2986', 'KOMMO_O:2981', 'GENGAR:2923',
    'INTELEON:2921', 'SWAMPERT:2902', 'MACHAMP:2898', 'MEWTWO:2891', 'DIALGA:2884']) assert.ok(found.includes(p), p);
  // The top row is cut off (its CPs scrolled away) and is left out.
  assert.ok(!read('storage-1').some((d) => d.name === 'Sylveon'));
  // Nothing invented from sprites.
  assert.ok(read('storage-1').every((d) => d.key || /Nick/.test(d.name)));
});

test('a CP only another form can reach picks that form, and asks to check it', () => {
  const zacian = read('storage-3').find((d) => d.name === 'Zacian');
  assert.equal(zacian.key, 'ZACIAN_CROWNED_SWORD');
  assert.equal(zacian.cp, 5266);
  assert.ok(zacian.problems.length);
});

test('nicknames are flagged for the player to pick, and moves are assumed', () => {
  const drafts = read('storage-2');
  assert.ok(drafts.some((d) => !d.key && /nickname/.test(d.problems[0])));
  const garchomp = drafts.find((d) => d.key === 'GARCHOMP');
  assert.equal(garchomp.cp, 2761);
  assert.equal(garchomp.movesUnknown, true);
  assert.ok(garchomp.fast && garchomp.charged.length);
});
