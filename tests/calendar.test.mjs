import { test } from 'node:test';
import assert from 'node:assert/strict';
import { icsTime, toIcs, raidCalendarEvents } from '../src/calendar.js';

test('local event times stay local ("floating"); UTC times keep their Z', () => {
  assert.equal(icsTime('2026-10-28T18:00:00.000'), '20261028T180000');
  assert.equal(icsTime('2026-11-06T01:00:00.000Z'), '20261106T010000Z');
  assert.equal(icsTime(new Date(2026, 10, 4, 6, 0)), '20261104T060000');
});

test('raid events become calendar events with alerts; others are left out', () => {
  const events = raidCalendarEvents([
    { eventID: 'rh', name: 'Giratina Raid Hour', eventType: 'raid-hour', start: '2026-11-04T18:00:00.000', end: '2026-11-04T19:00:00.000' },
    { eventID: 'rb', name: 'Palkia in 5-star Raid Battles', eventType: 'raid-battles', start: '2026-10-21T06:00:00.000', end: '2026-10-27T22:00:00.000' },
    { eventID: 'cd', name: 'Community Day', eventType: 'community-day', start: '2026-11-08T14:00:00.000', end: '2026-11-08T17:00:00.000' },
    { eventID: 'tba', name: 'Max Monday: to be announced', eventType: 'max-mondays', start: null, end: null },
  ]);
  assert.deepEqual(events.map((e) => [e.uid, e.alarmMinutes]), [['rh', 30], ['rb', 0]]);
  const ics = toIcs(events, { stamp: new Date(Date.UTC(2026, 9, 28)) });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART:20261104T180000\r\nDTEND:20261104T190000\r\nSUMMARY:Giratina Raid Hour/);
  assert.match(ics, /TRIGGER:-PT30M/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
});

test('long lines are folded at 75 bytes and text is escaped', () => {
  const ics = toIcs([{ uid: 'x', title: `Mega Charizard X, Mega Charizard Y; ${'and more '.repeat(10)}`, start: '2026-10-21T06:00:00', end: '2026-10-27T22:00:00' }]);
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  // Calendars join folded lines back together before reading them.
  assert.match(ics.replace(/\r\n /g, ''), /Mega Charizard X\\, Mega Charizard Y\\;/);
});
