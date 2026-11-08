import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  zonedToUtc, tzOffsetMinutes, classify, findCity, guessPlaceName, buildEvents, upcoming, countryList,
} from '../src/events.js';
import { RAID_SPOTS, EVENT_CITIES } from '../src/places.js';

const events = [
  { eventID: 'cd', name: 'Pawniard Community Day', eventType: 'community-day', start: '2026-11-21T14:00:00.000', end: '2026-11-21T17:00:00.000' },
  { eventID: 'london', name: 'Pokémon Night Out 2026 - London', eventType: 'event', start: '2026-11-10T18:00:00.000Z', end: '2026-11-10T22:30:00.000Z' },
  { eventID: 'sendai', name: 'Pokémon GO Wild Area 2026: Sendai • Tohoku', eventType: 'wild-area', start: '2026-11-06T01:00:00.000Z', end: '2026-11-08T09:00:00.000Z' },
  { eventID: 'global', name: 'Pokémon GO Wild Area 2026: Global', eventType: 'wild-area', start: '2026-11-14T10:00:00.000', end: '2026-11-15T18:00:00.000' },
  { eventID: 'gbl', name: 'Great League | Twilight Trails', eventType: 'go-battle-league', start: '2026-11-10T21:00:00.000Z', end: '2026-11-17T21:00:00.000Z' },
  { eventID: 'atlantis', name: 'Pokémon GO Safari Zone: Atlantis', eventType: 'safari-zone', start: '2026-12-01T01:00:00.000Z', end: '2026-12-02T09:00:00.000Z' },
];

test('local wall-clock times convert to the right moment, with daylight saving', () => {
  assert.equal(zonedToUtc('2026-11-21T14:00:00.000', 'Asia/Tokyo').toISOString(), '2026-11-21T05:00:00.000Z');
  assert.equal(zonedToUtc('2026-07-01T14:00:00', 'Europe/London').toISOString(), '2026-07-01T13:00:00.000Z');
  assert.equal(zonedToUtc('2026-01-01T14:00:00', 'Europe/London').toISOString(), '2026-01-01T14:00:00.000Z');
  assert.equal(zonedToUtc('2026-11-21T14:00:00', 'Pacific/Kiritimati').toISOString(), '2026-11-21T00:00:00.000Z');
  assert.equal(tzOffsetMinutes(new Date('2026-11-21T00:00:00Z'), 'Asia/Kathmandu'), 345);
});

test('events are classed as in person, worldwide local time, or one moment worldwide', () => {
  assert.equal(classify(events[0]).scope, 'local');
  assert.equal(classify(events[1]).city.city, 'London');
  assert.equal(classify(events[2]).city.city, 'Sendai');
  assert.equal(classify(events[3]).scope, 'local');
  assert.equal(classify(events[4]).scope, 'simultaneous');
  const unknown = classify(events[5]);
  assert.equal(unknown.scope, 'in-person');
  assert.equal(unknown.placeName, 'Atlantis');
  assert.equal(findCity('Pokémon GO Tour: Alola - Los Angeles 2027').city, 'Los Angeles');
  assert.equal(findCity('Pokémon GO Fest 2026: Jersey City').city, 'Jersey City');
  assert.equal(guessPlaceName('Pokémon GO Tour: Alola - Kaohsiung 2027'), 'Kaohsiung');
});

test('worldwide local-time events start first in Kiribati and last in American Samoa', () => {
  const cd = buildEvents(events).find((e) => e.id === 'cd');
  assert.equal(cd.places.length, RAID_SPOTS.length);
  assert.equal(cd.places[0].city, 'Kiritimati');
  assert.equal(cd.places.at(-1).country, 'American Samoa');
  assert.equal(cd.lastStart - cd.firstStart, 25 * 3600 * 1000);
  for (let i = 1; i < cd.places.length; i++) assert.ok(cd.places[i].start >= cd.places[i - 1].start);
});

test('in-person events have their city coordinates; events are listed by first start', () => {
  const list = buildEvents(events);
  const london = list.find((e) => e.id === 'london');
  assert.equal(london.places.length, 1);
  assert.equal(london.places[0].code, 'GB');
  assert.ok(Math.abs(london.places[0].lat - 51.5) < 0.1);
  assert.equal(list[0].id, 'sendai');
  for (let i = 1; i < list.length; i++) assert.ok(list[i].firstStart >= list[i - 1].firstStart);
  // Unknown places get coordinates once looked up.
  const found = buildEvents(events, { geocoded: { Atlantis: { city: 'Atlantis', country: 'Bahamas', code: 'BS', lat: 25.08, lon: -77.32, tz: null } } });
  assert.equal(found.find((e) => e.id === 'atlantis').places[0].lat, 25.08);
});

test('picking a country gives its own start times and drops other countries\' in-person events', () => {
  const list = buildEvents(events);
  const now = new Date('2026-11-01T00:00:00Z');
  const jp = upcoming(list, { now, country: 'JP' });
  assert.ok(jp.some((e) => e.id === 'sendai'));
  assert.ok(!jp.some((e) => e.id === 'london'));
  const cd = jp.find((e) => e.id === 'cd');
  assert.equal(cd.start.toISOString(), '2026-11-21T05:00:00.000Z');
  assert.ok(cd.rows.every((r) => r.code === 'JP'));
  assert.ok(!upcoming(list, { now }).some((e) => e.type === 'go-battle-league'));
  assert.ok(upcoming(list, { now, hideLong: false }).some((e) => e.type === 'go-battle-league'));
  // Finished events drop off.
  assert.ok(!upcoming(list, { now: new Date('2026-11-09T00:00:00Z') }).some((e) => e.id === 'sendai'));
});

test('place data is valid', () => {
  for (const p of [...RAID_SPOTS, ...EVENT_CITIES]) {
    assert.ok(Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180, p.city);
    assert.match(p.code, /^[A-Z]{2}$/);
    assert.doesNotThrow(() => tzOffsetMinutes(new Date(), p.tz), p.tz);
  }
  assert.ok(countryList().length >= 60);
});
