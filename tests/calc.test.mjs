import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  effectiveness, matchups, bossStats, catchCP, rankCounters, pickParty, budgetFilter, trainersNeeded,
} from '../src/calc.js';

const data = JSON.parse(readFileSync(new URL('../data/game.json', import.meta.url)));
const top = (key, tier, n = 10) => rankCounters(data, key, tier).slice(0, n).map((c) => c.name);

test('type effectiveness uses Pokémon GO multipliers', () => {
  assert.equal(effectiveness('Ice', ['Dragon', 'Flying'], data.typeChart).toFixed(3), '2.560');
  assert.equal(effectiveness('Ground', ['Flying'], data.typeChart).toFixed(3), '0.391');
  assert.deepEqual(matchups(['Psychic'], data).filter((m) => m.mult > 1).map((m) => m.type).sort(), ['Bug', 'Dark', 'Ghost']);
});

test('boss and catch CP match known values', () => {
  assert.equal(bossStats(data.pokemon.MEWTWO, '5').cp, 54148);
  assert.deepEqual(catchCP(data.pokemon.MEWTWO), { min: 2294, max: 2387 });
  assert.deepEqual(catchCP(data.pokemon.MEWTWO, true), { min: 2868, max: 2984 });
});

test('raid list covers every tier including Megas and Primals', () => {
  const tiers = new Set(data.raids.map((r) => r.tier));
  for (const t of ['1', '3', '5', 'mega', 'mega_legendary', 'primal']) assert.ok(tiers.has(t), t);
  assert.ok(data.raids.some((r) => r.key === 'GROUDON_PRIMAL' && r.tier === 'primal'));
});

test('counters favour super-effective attackers', () => {
  assert.ok(top('GROUDON_PRIMAL', 'primal', 3).includes('Primal Kyogre'));
  const vsMewtwo = rankCounters(data, 'MEWTWO', '5').slice(0, 10);
  assert.ok(vsMewtwo.every((c) => ['Dark', 'Ghost', 'Bug', 'Psychic'].includes(data.moves[c.charged].type)));
});

test('parties have six species and at most one Mega', () => {
  const counters = rankCounters(data, 'RAYQUAZA', '5');
  const party = pickParty(counters);
  assert.equal(party.length, 6);
  assert.equal(new Set(party.map((c) => c.dex)).size, 6);
  assert.ok(party.filter((c) => c.mega).length <= 1);
  assert.ok(pickParty(counters, budgetFilter).every(budgetFilter));
  assert.ok(trainersNeeded(party, '5') >= 1);
});

test('Super Mega parties lead with a shield-breaking Mega and need a trainer per shield', () => {
  const counters = rankCounters(data, 'CHANDELURE_MEGA', 'super_mega_4');
  for (const filter of [undefined, budgetFilter]) {
    const party = pickParty(counters, filter, { requireMega: true });
    assert.equal(party[0].mega, 'mega');
    assert.equal(party.filter((c) => c.mega).length, 1);
  }
  assert.ok(trainersNeeded(pickParty(counters), 'super_mega_4', 10) >= 10);
});

test('live raid data includes Super Mega and Shadow tiers', () => {
  const tiers = new Set(data.raids.map((r) => r.tier));
  for (const t of ['super_mega_4', 'super_mega_5', 'shadow_5']) assert.ok(tiers.has(t), t);
  assert.ok(data.raids.some((r) => r.key === 'VICTREEBEL_MEGA' && r.tier === 'super_mega_4'));
  assert.ok(data.pokemon.NIDORAN_FEMALE && data.pokemon.NIDORAN_MALE);
});

test('Max Battles only use Dynamax Pokémon and pick two attackers and a tank', async () => {
  const { rankMaxAttackers, rankMaxTanks, pickMaxTeam } = await import('../src/calc.js');
  const attackers = rankMaxAttackers(data, 'MACHOP', 'max_2');
  assert.ok(attackers.every((a) => data.pokemon[a.key].dynamax));
  assert.ok(['Psychic', 'Flying', 'Fairy'].includes(attackers[0].maxType));
  const gmax = rankMaxAttackers(data, 'CHARIZARD_GIGANTAMAX', 'max_6').find((a) => a.gmaxMove);
  assert.ok(gmax && data.pokemon[gmax.key].gmax);
  const team = pickMaxTeam(attackers, rankMaxTanks(data, 'MACHOP', 'max_2'));
  assert.deepEqual(team.map((t) => t.role), ['Attacker', 'Attacker', 'Tank']);
  assert.equal(new Set(team.map((t) => t.dex)).size, 3);
});
