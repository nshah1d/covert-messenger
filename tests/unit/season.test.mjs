import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countdownParts,
  gapToLeader,
  nextSession,
  sessionsOf
} from '../../app/dashboard/season.js';

const race = {
  round: '4',
  raceName: 'Fourth Grand Prix',
  date: '2026-04-12',
  time: '13:00:00Z',
  FirstPractice: { date: '2026-04-10', time: '09:00:00Z' },
  Sprint: { date: '2026-04-11', time: '10:00:00Z' },
  Qualifying: { date: '2026-04-11', time: '14:00:00Z' }
};

test('sessionsOf keeps weekend order and uses null for missing times', () => {
  const sessions = sessionsOf(race);
  assert.deepEqual(sessions.map(item => item.key), [
    'FirstPractice',
    'SecondPractice',
    'ThirdPractice',
    'SprintQualifying',
    'Sprint',
    'Qualifying',
    'Race'
  ]);
  assert.equal(sessions[0].label, 'FP1');
  assert.equal(sessions[0].start.toISOString(), '2026-04-10T09:00:00.000Z');
  assert.equal(sessions[1].start, null);
  assert.equal(sessions[6].start.toISOString(), '2026-04-12T13:00:00.000Z');
});

test('nextSession crosses a weekend boundary and returns null after the season', () => {
  const earlier = {
    ...race,
    round: '3',
    date: '2026-04-05',
    FirstPractice: { date: '2026-04-03', time: '09:00:00Z' },
    Sprint: undefined,
    Qualifying: { date: '2026-04-04', time: '14:00:00Z' }
  };
  const next = nextSession([earlier, race], new Date('2026-04-06T00:00:00Z'));
  assert.equal(next.key, 'FirstPractice');
  assert.equal(next.race.round, '4');
  assert.equal(nextSession([earlier, race], new Date('2026-04-13T00:00:00Z')), null);
  assert.equal(nextSession([earlier, race], new Date('2026-04-10T08:00:00Z')).key, 'FirstPractice');
});

test('gapToLeader formats leader and points gaps', () => {
  const standings = [{ points: '101' }, { points: '96' }, { points: '88.5' }];
  assert.equal(gapToLeader(standings, 0), 'LEADER');
  assert.equal(gapToLeader(standings, 1), '−5');
  assert.equal(gapToLeader(standings, 2), '−12.5');
  assert.equal(gapToLeader(standings, 4), '—');
});

test('countdownParts splits time and clamps at zero', () => {
  assert.deepEqual(countdownParts(90061000), { days: 1, hours: 1, minutes: 1, seconds: 1 });
  assert.deepEqual(countdownParts(-5000), { days: 0, hours: 0, minutes: 0, seconds: 0 });
});
