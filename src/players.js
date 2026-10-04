import { pickMissions } from './missions.js';

// Pass-and-play: up to four players share one board and take turns on one
// screen. The game itself has one rack, one score and one set of missions;
// each player keeps their own, and seat() swaps them in when it is their
// turn, so the rules in game.js never need to know there is more than one.

export const MAX_PLAYERS = 4;
const TURNS_EACH = 6; // per player, when more than one plays

// Everyone races for the same three missions, each ticking off their own copy.
export function createPlayers(names, level, random = Math.random) {
  const missions = pickMissions(random, level);
  return names.slice(0, MAX_PLAYERS).map((name, i) => ({
    name: name.trim() || (names.length === 1 ? 'You' : `Player ${i + 1}`),
    rack: [],
    score: 0,
    missions: missions.map((mission) => ({ ...mission })),
  }));
}

// Turns for the whole run: the level's own for one player, six each for more.
export const turnsFor = (level, count) => (count > 1 ? TURNS_EACH * count : level.turns);

// Puts player `next` in the seat: saves the seated player's rack, score and
// missions, and loads the next player's into the game.
export function seat(game, players, current, next) {
  if (current !== null && players[current]) {
    Object.assign(players[current], { rack: game.rack, score: game.score, missions: game.missions });
  }
  const player = players[next];
  game.rack = player.rack;
  game.score = player.score;
  game.missions = player.missions;
  return next;
}

// Players by score, best first; ties share a place.
export function standings(players) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  return sorted.map((player) => ({ ...player, place: sorted.findIndex((other) => other.score === player.score) + 1 }));
}
