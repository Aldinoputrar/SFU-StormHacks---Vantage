import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBoard } from '../src/board.js';
import { createGame } from '../src/game.js';
import { PLAZA } from '../src/level.js';
import { HINTS, POWERS, grant, prizeChoices } from '../src/powers.js';
import { mulberry32 } from '../src/random.js';

test('two stars offer two different big prizes, one star the small ones, none nothing', () => {
  const random = mulberry32(6);
  for (let i = 0; i < 50; i++) {
    const big = prizeChoices(2, random);
    assert.equal(big.length, 2);
    assert.notEqual(big[0], big[1]);
    assert.ok(big.every((id) => POWERS[id].tier === 2));
    assert.deepEqual(prizeChoices(1, random).sort(), ['hint', 'swap']);
  }
  assert.deepEqual(prizeChoices(0), []);
});

test('each prize does what it says', () => {
  const game = createGame(PLAZA, buildBoard(PLAZA));
  const player = { name: 'Ada' };
  const turns = game.turnsLeft;
  grant(game, player, 'wild');
  assert.deepEqual(game.rack, ['?']);
  grant(game, player, 'turn');
  assert.equal(game.turnsLeft, turns + 1);
  grant(game, player, 'hint');
  assert.equal(player.hints, HINTS + 1);
  grant(game, player, 'double');
  grant(game, player, 'swap');
  grant(game, player, 'swap');
  assert.deepEqual(player.powers, { double: 1, swap: 2 });
  assert.equal(player.won, 6);
  assert.throws(() => grant(game, player, 'nonsense'));
});
