// Missions: three small goals for each run, so there is always something to
// try next. Each is checked against a turn as it is played; finishing one
// earns bonus points. Nothing here touches the screen.

export const MISSION_POINTS = 15;

export const MISSIONS = [
  { id: 'cross', text: 'Cross the gap: play a word that spans two surfaces', word: (turn) => turn.points.surfaces > 1 },
  { id: 'loop', text: 'Write on the endless loop round the crown', word: (turn) => turn.cyclic },
  { id: 'bridge', text: 'Swing the bridge and play a word on it', word: (turn) => turn.onBridge },
  { id: 'big', text: 'Score 40 or more with one word', word: (turn) => turn.points.total >= 40 },
  {
    id: 'bonus',
    text: 'Land a word on a double- or triple-word square',
    word: (turn) => turn.points.bonuses.some((kind) => kind === 'DW' || kind === 'TW'),
  },
  { id: 'long', text: 'Play a word of six letters or more', word: (turn) => turn.word.length >= 6 },
  { id: 'rare', text: 'Play a J, Q, X or Z', word: (turn) => turn.placed.some(({ letter }) => 'JQXZ'.includes(letter)) },
  { id: 'chamber', text: 'Win a two-star prize in the chamber', chamber: (stars) => stars >= 2 },
];

// Crossing the gap is the heart of the game, so it is always one of the three.
// Missions about the loop or the bridge are only dealt on maps that have them.
export function pickMissions(random = Math.random, level = null) {
  const rest = MISSIONS.filter(
    ({ id }) =>
      id !== 'cross' && !(level && id === 'loop' && !level.loops?.length) && !(level && id === 'bridge' && !level.bridge),
  );
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [MISSIONS[0], ...rest.slice(0, 2)].map(({ id, text }) => ({ id, text, done: false }));
}

// Marks the missions an event completes and returns them. event is
// { turn } for a word played, or { chamber } for a chamber score.
export function completeMissions(missions, event) {
  const finished = [];
  for (const mission of missions) {
    if (mission.done) continue;
    const rule = MISSIONS.find(({ id }) => id === mission.id);
    const met = event.turn ? rule.word?.(event.turn) : event.chamber !== undefined && rule.chamber?.(event.chamber);
    if (!met) continue;
    mission.done = true;
    finished.push(mission);
  }
  return finished;
}
