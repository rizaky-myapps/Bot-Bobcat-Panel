import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTimeInput,
  parseDateInput,
  resolveTimeNear,
  isoWeek,
  isoWeekRange,
  formatDuration,
  parseDurationInput,
  fromDatetimeLocal,
  toDatetimeLocal,
} from '../src/utils/times.js';

test('parseTimeInput accepte les formats flexibles', () => {
  assert.deepEqual(parseTimeInput('21h'), { h: 21, m: 0 });
  assert.deepEqual(parseTimeInput('21h30'), { h: 21, m: 30 });
  assert.deepEqual(parseTimeInput('21:30'), { h: 21, m: 30 });
  assert.deepEqual(parseTimeInput('2130'), { h: 21, m: 30 });
  assert.deepEqual(parseTimeInput('930'), { h: 9, m: 30 });
  assert.deepEqual(parseTimeInput('9'), { h: 9, m: 0 });
  assert.deepEqual(parseTimeInput(' 00H '), { h: 0, m: 0 });
  assert.deepEqual(parseTimeInput('24h'), { h: 0, m: 0 });
  assert.equal(parseTimeInput('25h'), null);
  assert.equal(parseTimeInput('21h75'), null);
  assert.equal(parseTimeInput('abc'), null);
  assert.equal(parseTimeInput(''), null);
});

test('parseDateInput gère les années et dates invalides', () => {
  const ref = new Date(2026, 9, 29);
  assert.equal(parseDateInput('16/05', ref).getFullYear(), 2027); // passée depuis > 30 jours
  assert.equal(parseDateInput('20/10', ref).getFullYear(), 2026); // récente
  assert.equal(parseDateInput('05/11', ref).getMonth(), 10);
  assert.equal(parseDateInput('16/05/25', ref).getFullYear(), 2025);
  assert.equal(parseDateInput('31/02', ref), null);
  assert.equal(parseDateInput('hello', ref), null);
});

test('resolveTimeNear gère le passage de minuit', () => {
  const now = new Date(2026, 9, 30, 0, 40);
  const arrival = resolveTimeNear({ h: 23, m: 30 }, now);
  assert.equal(arrival.getDate(), 29);
  const later = resolveTimeNear({ h: 0, m: 20 }, now);
  assert.equal(later.getDate(), 30);
  const notBefore = new Date(2026, 9, 29, 23, 0);
  const leave = resolveTimeNear({ h: 22, m: 0 }, now, { notBefore });
  assert.ok(leave >= notBefore);
});

test('isoWeek et isoWeekRange', () => {
  assert.deepEqual(isoWeek(new Date(2026, 9, 29)), { year: 2026, week: 44 });
  assert.deepEqual(isoWeek(new Date(2027, 0, 1)), { year: 2026, week: 53 });
  assert.deepEqual(isoWeek(new Date(2025, 11, 29)), { year: 2026, week: 1 });
  const { start, end } = isoWeekRange(2026, 44);
  assert.equal(start.getDay(), 1);
  assert.equal(start.getDate(), 26);
  assert.equal(end.getDate(), 2);
});

test('formatDuration et parseDurationInput', () => {
  assert.equal(formatDuration(45), '45 min');
  assert.equal(formatDuration(65), '1h05');
  assert.equal(formatDuration(120), '2h00');
  assert.equal(parseDurationInput('2h'), 120);
  assert.equal(parseDurationInput('1h30'), 90);
  assert.equal(parseDurationInput('45min'), 45);
  assert.equal(parseDurationInput('x'), null);
});

test('datetime-local aller-retour', () => {
  const d = new Date(2026, 9, 29, 21, 5);
  assert.equal(toDatetimeLocal(d), '2026-10-29T21:05');
  assert.equal(fromDatetimeLocal('2026-10-29T21:05').getTime(), d.getTime());
});
