import { WILD } from './game.js';

// Power-ups: what a game in the chamber wins. Two stars offers a choice of
// two big prizes, one star the two small ones, none nothing. Each is
// something the player can see and use, not a hidden improvement.

export const HINTS = 3; // hints each player starts with

export const POWERS = {
  wild: { name: 'Wild tile', mark: '★', text: 'A tile that can be any letter. It scores nothing itself.', tier: 2 },
  double: { name: 'Double score', mark: '×2', text: 'Arm it before a word: that turn scores double.', tier: 2 },
  turn: { name: 'Extra turn', mark: '+1', text: 'One more turn this run.', tier: 2 },
  hint: { name: 'Extra hint', mark: '?', text: 'One more hint.', tier: 1 },
  swap: { name: 'Free swap', mark: '⇄', text: 'Swap your letters once without using a turn.', tier: 1 },
};

// The prizes on offer for a result: two to choose from, or none.
export function prizeChoices(stars, random = Math.random) {
  if (stars <= 0) return [];
  const tier = Object.keys(POWERS).filter((id) => POWERS[id].tier === Math.min(stars, 2));
  for (let i = tier.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [tier[i], tier[j]] = [tier[j], tier[i]];
  }
  return tier.slice(0, 2);
}

// Gives the seated player a prize. Tokens kept for later live on the player;
// the rest take effect at once.
export function grant(game, player, id) {
  player.powers ??= { double: 0, swap: 0 };
  if (id === 'wild') game.rack.push(WILD);
  else if (id === 'turn') game.turnsLeft++;
  else if (id === 'hint') player.hints = (player.hints ?? HINTS) + 1;
  else if (id === 'double' || id === 'swap') player.powers[id]++;
  else throw new Error(`No such power-up: ${id}`);
  player.won = (player.won ?? 0) + 1;
}
