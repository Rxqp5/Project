import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nameIndex, scheduleItems, rotationDays } from '../src/schedule.js';

const data = JSON.parse(readFileSync(new URL('../data/game.json', import.meta.url)));

const event = (name, eventType, start, end, bosses) => ({
  name, eventType, start, end, link: 'https://leekduck.com/events/x/',
  extraData: bosses ? { raidbattles: { bosses: bosses.map((b) => ({ name: b, canBeShiny: true })) } } : {},
});

const events = [
  event('Palkia in 5-star Raid Battles', 'raid-battles', '2026-10-21T06:00:00', '2026-10-27T22:00:00', ['Palkia']),
  event('Giratina (Origin Forme) in 5-star Raid Battles', 'raid-battles', '2026-10-28T06:00:00', '2026-11-03T22:00:00', ['Giratina (Origin)']),
  event('Shadow Landorus in Shadow Raids', 'raid-battles', '2026-10-07T06:00:00', '2026-11-03T22:00:00', ['Landorus (Incarnate)']),
  event('Chandelure Super Mega Raid Day', 'raid-day', '2026-10-31T14:00:00', '2026-10-31T17:00:00'),
  event('Dynamax Machop during Max Monday', 'max-mondays', '2026-11-02T06:00:00', '2026-11-02T21:00:00'),
];

test('LeekDuck names resolve to our Pokémon', () => {
  const resolve = nameIndex(data);
  assert.equal(resolve('Alolan Raichu'), 'RAICHU_ALOLA');
  assert.equal(resolve('Shadow Gastly'), 'GASTLY');
  assert.equal(resolve('Giratina (Origin Forme)'), 'GIRATINA_ORIGIN');
  assert.equal(resolve('Mega Charizard Y'), 'CHARIZARD_MEGA_Y');
});

test('events become bosses and specials with the right tiers', () => {
  const items = scheduleItems(events, data);
  const find = (name) => items.find((i) => i.name === name);
  assert.equal(find('Giratina (Origin)').tier, '5');
  assert.equal(find('Landorus (Incarnate)').tier, 'shadow_5');
  assert.deepEqual([find('Chandelure').key, find('Chandelure').tier], ['CHANDELURE', 'super_mega_4']);
  assert.equal(find('Dynamax Machop').tier.startsWith('max_'), true);
});

test('rotation lists each day and flags the first day a boss appears', () => {
  const days = rotationDays(scheduleItems(events, data), new Date('2026-10-28T09:00:00'));
  assert.equal(days[0].date.getDate(), 28);
  const today = days[0].items.map((i) => i.name);
  assert.ok(!today.includes('Palkia'), 'ended bosses are dropped');
  assert.ok(days[0].items.every((i) => i.first));
  assert.ok(days[1].items.every((i) => !i.first));
  const oct31 = days.find((d) => d.date.getDate() === 31);
  assert.ok(oct31.items.find((i) => i.name === 'Chandelure').first);
  assert.equal(days.at(-1).date.getDate(), 3, 'runs until the last event ends');
});
