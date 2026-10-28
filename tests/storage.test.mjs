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

test('the shiny sparkle under a CP is detected by its colour', async () => {
  const { sparkleScore, SPARKLE_MIN_PIXELS, isSparklePixel } = await import('../src/scan.js');
  const width = 1290;
  const height = 400;
  const blank = () => {
    const px = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < px.length; i += 4) px.set([240, 248, 240, 255], i);
    return px;
  };
  const cpBox = { x0: 180, y0: 100, x1: 330, y1: 150 };
  const paint = (px, rgb) => {
    for (let y = 150; y < 175; y++) for (let x = 120; x < 160; x++) px.set([...rgb, 255], (y * width + x) * 4);
  };
  const shiny = blank();
  paint(shiny, [48, 96, 112]); // the sparkle's slate blue
  const sharpedo = blank();
  paint(sharpedo, [32, 80, 128]); // a blue sprite
  const label = blank();
  paint(label, [80, 100, 108]); // the grey "CP" label
  assert.ok(sparkleScore(shiny, width, height, cpBox) >= SPARKLE_MIN_PIXELS);
  assert.equal(sparkleScore(sharpedo, width, height, cpBox), 0);
  assert.equal(sparkleScore(label, width, height, cpBox), 0);
  assert.equal(isSparklePixel(48, 96, 112), true);
});

test('storage tiles carry their CP box, and shiny tiles make shiny drafts', () => {
  const tiles = parseGrid(screens['storage-1'], width);
  assert.ok(tiles.filter((t) => t.cpText).every((t) => t.cpBox && t.cpBox.x1 > t.cpBox.x0));
  const drafts = readGridTiles(tiles.map((t) => ({ ...t, shiny: t.name === 'Aggron' })), data, width);
  assert.equal(drafts.find((d) => d.key === 'AGGRON').shiny, true);
  assert.equal(drafts.find((d) => d.key === 'GYARADOS').shiny, false);
});
