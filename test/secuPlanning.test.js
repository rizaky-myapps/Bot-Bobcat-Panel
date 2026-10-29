import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDaysSpec, parseRanges, parsePlanning, buildSecuDays } from '../src/db/services/secuPlanning.js';

const ref = new Date(2026, 7, 1);

test('parseDaysSpec : plage et liste', () => {
  const a = parseDaysSpec('17/08:3', ref);
  assert.equal(a.error, null);
  assert.deepEqual(a.dates.map((d) => d.getDate()), [17, 18, 19]);
  const b = parseDaysSpec('14/08,17/08', ref);
  assert.deepEqual(b.dates.map((d) => d.getDate()), [14, 17]);
  assert.ok(parseDaysSpec('abc', ref).error);
  assert.ok(parseDaysSpec('01/08:30', ref).error);
});

test('parseRanges : simple, multiple, découpage', () => {
  assert.deepEqual(parseRanges('19h-00h').ranges, [{ start: { h: 19, m: 0 }, end: { h: 0, m: 0 } }]);
  assert.equal(parseRanges('19h-21h,21h-23h').ranges.length, 2);
  const split = parseRanges('19h-01h/2h').ranges;
  assert.equal(split.length, 3);
  assert.deepEqual(split[2], { start: { h: 23, m: 0 }, end: { h: 1, m: 0 } });
  assert.ok(parseRanges('19h').error);
});

test('parsePlanning : overrides et repos', () => {
  const { overrides, error } = parsePlanning('17/08=20h-23h; 18/08 off\n19/08: 18h-20h, 20h-22h', ref);
  assert.equal(error, null);
  assert.equal(overrides.size, 3);
  const values = [...overrides.values()];
  assert.equal(values[1].ranges, null);
  assert.equal(values[2].ranges.length, 2);
});

test('buildSecuDays applique template et planning', () => {
  const { days, error } = buildSecuDays({
    daysSpec: '17/08:3',
    template: '19h-23h/2h',
    planning: '18/08 off; 19/08=20h-00h',
    capacity: 3,
    ref,
  });
  assert.equal(error, null);
  assert.equal(days.length, 2);
  assert.equal(days[0].slots.length, 2);
  assert.equal(days[0].slots[0].label, 'TEAM 1');
  assert.equal(days[0].slots[1].startAt.getHours(), 21);
  const last = days[1].slots[0];
  assert.equal(last.endAt.getDate(), 20); // minuit = lendemain
  assert.equal(last.capacity, 3);
});
