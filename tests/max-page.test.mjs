import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { maxOverview } from '../src/max-page.js';

const data = JSON.parse(readFileSync(new URL('../data/game.json', import.meta.url)));
const mine = [
  { id: 'z', key: 'ZACIAN_CROWNED_SWORD', cp: 5266, level: 44.5, ivs: { atk: 15, def: 15, sta: 15 }, fast: 'METAL_CLAW_FAST', charged: ['BEHEMOTH_BLADE'], dynamax: true },
  { id: 'm', key: 'METAGROSS', cp: 3701, level: 40.5, fast: 'SHADOW_CLAW_FAST', charged: ['FLASH_CANNON'], dynamax: true },
  { id: 'n', key: 'MACHAMP', cp: 2898, level: 37.5, fast: 'COUNTER_FAST', charged: ['CLOSE_COMBAT'], shadow: true },
];

test('Max overview: current Max bosses (2★+), your Dynamax team, and what to get', () => {
  const o = maxOverview(data, mine);
  assert.ok(o.bosses.length > 0);
  assert.ok(o.bosses.every((b) => b.status === 'current' && b.tier !== 'max_1'));
  // Only Pokémon marked Dynamax join a Max team.
  assert.ok(o.bosses.every((b) => b.yours.every((m) => ['z', 'm'].includes(m.entryId))));
  assert.ok(o.usage.length > 0);
  // Suggestions never include what you already have as Dynamax.
  assert.ok(o.wanted.every((w) => !['ZACIAN_CROWNED_SWORD', 'METAGROSS'].includes(w.key)));
  assert.ok(o.wanted.length > 0);
});
