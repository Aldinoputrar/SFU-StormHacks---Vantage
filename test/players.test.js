import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBoard } from '../src/board.js';
import { createGame } from '../src/game.js';
import { loadScores, saveScores, topScores } from '../src/leaderboard.js';
import { COURTYARD, MONUMENT } from '../src/level.js';
import { pickMissions } from '../src/missions.js';
import { createPlayers, seat, standings, turnsFor } from '../src/players.js';
import { mulberry32 } from '../src/random.js';

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) };
}

test('each player keeps their own rack, score and missions as turns pass', () => {
  const game = createGame(MONUMENT, buildBoard(MONUMENT));
  const players = createPlayers(['Ada', '', 'Cy'], MONUMENT, mulberry32(1));
  assert.deepEqual(players.map(({ name }) => name), ['Ada', 'Player 2', 'Cy']);
  // The same missions for everyone, but each player's own copy.
  assert.deepEqual(players[1].missions, players[0].missions);
  players[0].missions[0].done = true;
  assert.equal(players[1].missions[0].done, false);
  let at = seat(game, players, null, 0);
  game.rack.push('A');
  game.score = 10;
  at = seat(game, players, at, 1);
  assert.deepEqual(game.rack, []);
  assert.equal(game.score, 0);
  game.score = 4;
  at = seat(game, players, at, 0);
  assert.deepEqual(game.rack, ['A']);
  assert.equal(game.score, 10);
  assert.equal(players[1].score, 4);
  assert.equal(at, 0);
});

test('a solo player is called You and plays the level\'s turns; more players get six each', () => {
  assert.equal(createPlayers([''], MONUMENT)[0].name, 'You');
  assert.equal(turnsFor(MONUMENT, 1), MONUMENT.turns);
  assert.equal(turnsFor(MONUMENT, 3), 18);
});

test('standings rank players by score and share places on a tie', () => {
  const ranked = standings([{ name: 'A', score: 5 }, { name: 'B', score: 9 }, { name: 'C', score: 5 }]);
  assert.deepEqual(ranked.map(({ name, place }) => `${place}${name}`), ['1B', '2A', '2C']);
});

test('maps without a loop or a bridge never deal missions about them', () => {
  const random = mulberry32(9);
  for (let i = 0; i < 40; i++) {
    const ids = pickMissions(random, COURTYARD).map(({ id }) => id);
    assert.ok(!ids.includes('loop') && !ids.includes('bridge'), ids.join());
  }
});

test('the leaderboard keeps the best scores for each map', () => {
  const storage = memoryStorage();
  saveScores([{ name: 'Ada', score: 120, map: 'monument', words: 5 }], storage, 1);
  saveScores([{ name: 'Bo', score: 80, map: 'monument', words: 3 }, { name: 'Cy', score: 0, map: 'monument', words: 0 }], storage, 2);
  saveScores([{ name: 'Di', score: 200, map: 'spire', words: 6 }], storage, 3);
  assert.deepEqual(topScores('monument', 5, storage).map(({ name, place }) => `${place}${name}`), ['1Ada', '2Bo']);
  assert.equal(topScores('spire', 5, storage)[0].score, 200);
  assert.equal(loadScores(storage).length, 3, 'zero scores are not kept');
});

test('a refused or broken store leaves the leaderboard empty rather than failing', () => {
  const refusing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.deepEqual(loadScores(refusing), []);
  assert.doesNotThrow(() => saveScores([{ name: 'A', score: 5, map: 'm', words: 1 }], refusing));
  assert.deepEqual(loadScores({ getItem: () => '{oops', setItem() {} }), []);
});
