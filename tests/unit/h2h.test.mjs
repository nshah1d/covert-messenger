import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { better, headToHeadCounts, seasonRecord } from '../../app/dashboard/h2hStats.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/f1/${name}.json`, import.meta.url), 'utf8'));
const record = (id) => seasonRecord(fixture(`2026_drivers_${id}_results`), fixture(`2026_drivers_${id}_sprint`), fixture(`2026_drivers_${id}_qualifying`));

const race = (round, positionText, points, position = positionText) => ({
  round: String(round), raceName: `Race ${round}`, Results: [{ position: String(position), positionText, points: String(points) }]
});
const wrap = (races) => ({ MRData: { RaceTable: { Races: races } } });

test('season record counts finishes, podiums, points finishes and retirements', () => {
  const result = seasonRecord(wrap([race(1, '1', 25), race(2, 'R', 0, 18), race(3, '4', 12), race(4, '11', 0)]),
    wrap([{ round: '3', SprintResults: [{ points: '5' }] }]),
    wrap([{ round: '1', QualifyingResults: [{ position: '2' }] }]));
  assert.equal(result.starts, 4);
  assert.equal(result.podiums, 1);
  assert.equal(result.pointsFinishes, 2);
  assert.equal(result.best, 1);
  assert.equal(result.average, (1 + 4 + 11) / 3);
  assert.equal(result.retirements, 1);
  assert.equal(result.rounds[1].label, 'DNF');
  assert.equal(result.rounds[0].qualifying, 2);
  assert.deepEqual(result.cumulative.map((p) => p.total), [25, 25, 42, 42]);
});

test('cumulative points match the championship total from real data', () => {
  const standings = fixture('2026_driverStandings').MRData.StandingsTable.StandingsLists[0].DriverStandings;
  for (const id of ['antonelli', 'russell']) {
    const total = record(id).cumulative.at(-1).total;
    const official = Number(standings.find((s) => s.Driver.driverId === id).points);
    assert.equal(total, official, id);
  }
});

test('head-to-head counts only shared rounds and ignores ties', () => {
  const left = seasonRecord(wrap([race(1, '1', 25), race(2, '5', 10), race(3, 'R', 0, 19)]), null,
    wrap([{ round: '1', QualifyingResults: [{ position: '1' }] }, { round: '2', QualifyingResults: [{ position: '4' }] }]));
  const right = seasonRecord(wrap([race(1, '2', 18), race(2, '3', 15), race(4, '1', 25)]), null,
    wrap([{ round: '1', QualifyingResults: [{ position: '3' }] }, { round: '2', QualifyingResults: [{ position: '2' }] }]));
  assert.deepEqual(headToHeadCounts(left, right), { raceLeft: 1, raceRight: 1, qualiLeft: 1, qualiRight: 1, shared: 2 });
});

test('real teammates add up to their shared rounds', () => {
  const counts = headToHeadCounts(record('antonelli'), record('russell'));
  assert.ok(counts.shared > 0);
  assert.ok(counts.raceLeft + counts.raceRight <= counts.shared);
  assert.ok(counts.qualiLeft + counts.qualiRight <= counts.shared);
});

test('better respects direction and ties', () => {
  assert.equal(better(10, 5), -1);
  assert.equal(better(10, 5, true), 1);
  assert.equal(better(3, 3), 0);
  assert.equal(better(null, 3), 0);
});
