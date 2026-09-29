function races(data) {
  return data?.MRData?.RaceTable?.Races || [];
}

function numeric(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * One driver's season from Jolpica results, sprint and qualifying responses.
 *
 * A round counts as a finish only when its position text is a number; anything
 * else (retired, disqualified, not classified) counts as a retirement and is
 * left out of best and average finish. `order` is the classified order and
 * decides who finished ahead. Cumulative points include sprints.
 */
export function seasonRecord(resultsData, sprintData, qualifyingData) {
  const rounds = new Map();
  for (const race of races(resultsData)) {
    const result = race.Results?.[0];
    if (!result) continue;
    const classified = /^\d+$/.test(result.positionText || '');
    rounds.set(Number(race.round), {
      round: Number(race.round),
      name: race.raceName || '',
      order: numeric(result.position),
      finish: classified ? Number(result.positionText) : null,
      label: classified ? `P${result.positionText}` : (result.positionText === 'R' ? 'DNF' : result.positionText || '—'),
      points: numeric(result.points) || 0,
      sprintPoints: 0,
      qualifying: null
    });
  }
  for (const race of races(sprintData)) {
    const entry = rounds.get(Number(race.round));
    if (entry) entry.sprintPoints = numeric(race.SprintResults?.[0]?.points) || 0;
  }
  for (const race of races(qualifyingData)) {
    const entry = rounds.get(Number(race.round));
    if (entry) entry.qualifying = numeric(race.QualifyingResults?.[0]?.position);
  }

  const list = [...rounds.values()].sort((a, b) => a.round - b.round);
  const finishes = list.map(entry => entry.finish).filter(value => value !== null);
  let running = 0;
  const cumulative = list.map(entry => {
    running += entry.points + entry.sprintPoints;
    return { round: entry.round, total: running };
  });

  return {
    rounds: list,
    starts: list.length,
    podiums: finishes.filter(value => value <= 3).length,
    pointsFinishes: list.filter(entry => entry.points > 0).length,
    best: finishes.length ? Math.min(...finishes) : null,
    average: finishes.length ? finishes.reduce((sum, value) => sum + value, 0) / finishes.length : null,
    retirements: list.filter(entry => entry.finish === null).length,
    cumulative
  };
}

/** Rounds where each driver finished and qualified ahead, over the rounds both started. */
export function headToHeadCounts(left, right) {
  const rightByRound = new Map(right.rounds.map(entry => [entry.round, entry]));
  const counts = { raceLeft: 0, raceRight: 0, qualiLeft: 0, qualiRight: 0, shared: 0 };
  for (const entry of left.rounds) {
    const other = rightByRound.get(entry.round);
    if (!other) continue;
    counts.shared += 1;
    if (entry.order !== null && other.order !== null && entry.order !== other.order) {
      if (entry.order < other.order) counts.raceLeft += 1;
      else counts.raceRight += 1;
    }
    if (entry.qualifying !== null && other.qualifying !== null && entry.qualifying !== other.qualifying) {
      if (entry.qualifying < other.qualifying) counts.qualiLeft += 1;
      else counts.qualiRight += 1;
    }
  }
  return counts;
}

/** -1 when the left value is better, 1 when the right is, 0 for a tie or a missing value. */
export function better(leftValue, rightValue, lowerWins = false) {
  if (leftValue === null || rightValue === null || leftValue === rightValue) return 0;
  const leftAhead = lowerWins ? leftValue < rightValue : leftValue > rightValue;
  return leftAhead ? -1 : 1;
}
