import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rankCounters } from '../src/calc.js';
import { typeRankings, typeRanksFor, adviseEntry, powerUpCost } from '../src/advice.js';

const data = JSON.parse(readFileSync(new URL('../data/game.json', import.meta.url)));
const rankings = typeRankings(data);
const bosses = [{ key: 'GIRATINA_ORIGIN', tier: '5', counters: rankCounters(data, 'GIRATINA_ORIGIN', '5') }];

test('type rankings put known top attackers near the top', () => {
  assert.ok(typeRanksFor(rankings, 'TYRANITAR', true).find((t) => t.type === 'Dark').rank <= 3);
  assert.ok(typeRanksFor(rankings, 'RAYQUAZA', false).find((t) => t.type === 'Dragon').rank <= 15);
});

test('power-up cost to level 40 matches the game table', () => {
  // Level 30 → 40: 2 power-ups per level, 5000/6000/7000/8000/9000 stardust in pairs of levels.
  assert.deepEqual(powerUpCost(data, 30, 40), { stardust: 150000, candy: 182, xl: 0 });
  assert.equal(powerUpCost(data, 30, 40, { shadow: true }).stardust, 180000);
});

test('verdicts: strong low-level raiders get "power up", weak ones "don\'t"', () => {
  const ttar = adviseEntry(data, { key: 'TYRANITAR', cp: 3265, level: 30, fast: 'BITE_FAST', charged: ['CRUNCH'] }, { rankings, bosses });
  assert.equal(ttar.verdict, 'power');
  assert.ok(ttar.notes.some((n) => /Brutal Swing/.test(n)));
  const furret = adviseEntry(data, { key: 'FURRET', cp: 1200, level: 25, fast: 'SUCKER_PUNCH_FAST', charged: ['SWIFT'] }, { rankings, bosses });
  assert.equal(furret.verdict, 'skip');
  const maxed = adviseEntry(data, { key: 'TYRANITAR', cp: 3900, level: 40, fast: 'BITE_FAST', charged: ['BRUTAL_SWING'] }, { rankings, bosses });
  assert.equal(maxed.verdict, 'ready');
});
