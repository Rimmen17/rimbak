import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateKey, endIso, monthGrid, nameToEmail, splitIso, toIso } from '../js/dates.js';

test('nameToEmail lowercases and maps Danish letters', () => {
  assert.equal(nameToEmail('Joan', 'x.example'), 'joan@x.example');
  assert.equal(nameToEmail('  Søren Åge ', 'x.example'), 'soerenaage@x.example');
  assert.equal(nameToEmail('René', 'x.example'), 'rene@x.example');
});

test('nameToEmail rejects empty and symbol-only names', () => {
  assert.throws(() => nameToEmail('', 'x.example'));
  assert.throws(() => nameToEmail(' @!', 'x.example'));
});

test('nameToEmail cannot be used to pick another domain', () => {
  assert.equal(nameToEmail('joan@evil.com', 'x.example'), 'joanevilcom@x.example');
});

test('toIso and splitIso round-trip a local date and time', () => {
  assert.deepEqual(splitIso(toIso('2026-10-17', '18:30')), { date: '2026-10-17', time: '18:30' });
});

test('toIso rejects nonsense', () => {
  assert.throws(() => toIso('', ''));
});

test('endIso is null without an end time', () => {
  assert.equal(endIso('2026-10-17', '18:00', ''), null);
});

test('endIso keeps the same day when the end is later', () => {
  assert.deepEqual(splitIso(endIso('2026-10-17', '18:00', '21:00')), { date: '2026-10-17', time: '21:00' });
});

test('endIso rolls past midnight when the end is not after the start', () => {
  assert.deepEqual(splitIso(endIso('2026-10-31', '20:00', '02:00')), { date: '2026-11-01', time: '02:00' });
});

test('monthGrid starts on Monday and covers whole weeks', () => {
  const grid = monthGrid(2026, 9); // October 2026, the 1st is a Thursday
  assert.equal(grid.length, 35);
  assert.equal(dateKey(grid[0]), '2026-09-28');
  assert.equal(grid[0].getDay(), 1);
  assert.equal(dateKey(grid.at(-1)), '2026-11-01');
});

test('monthGrid handles a month that starts on Monday', () => {
  const grid = monthGrid(2027, 1); // February 2027: 1st is a Monday, 28 days
  assert.equal(grid.length, 28);
  assert.equal(dateKey(grid[0]), '2027-02-01');
});
