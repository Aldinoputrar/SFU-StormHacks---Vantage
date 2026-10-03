import { LETTER_VALUES } from './level.js';

const $ = (id) => document.getElementById(id);

function rackTile(letter, index) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tile';
  button.dataset.index = index;
  button.textContent = letter;
  const value = document.createElement('sub');
  value.textContent = LETTER_VALUES[letter];
  button.append(value);
  return button;
}

function patternTile({ letter, pending, cursor, joint, bonus }) {
  const span = document.createElement('span');
  span.textContent = letter || bonus || '';
  if (bonus) span.dataset.bonus = bonus;
  span.classList.toggle('letter', Boolean(letter));
  span.classList.toggle('pending', pending);
  span.classList.toggle('cursor', cursor);
  span.classList.toggle('joint', joint);
  return span;
}

export function createHud({ onRack, onPlay, onUndo, onCancel, onIso, onReveal, onTurn }) {
  $('play').addEventListener('click', onPlay);
  $('undo').addEventListener('click', onUndo);
  $('cancel').addEventListener('click', onCancel);
  $('iso').addEventListener('click', onIso);
  $('reveal').addEventListener('click', onReveal);
  $('turn').addEventListener('click', onTurn);
  $('rack').addEventListener('click', (event) => {
    const tile = event.target.closest('[data-index]');
    if (tile) onRack(Number(tile.dataset.index));
  });

  return {
    render({ game, placing, canReveal, canTurn, headline, hint, pattern, message }) {
      $('score').textContent = game.score;
      $('turns').textContent = game.turnsLeft;
      $('bag').textContent = game.bag.length;
      $('rack').replaceChildren(...game.rack.map(rackTile));
      $('rack').classList.toggle('idle', !placing);
      $('play').disabled = !game.pending.length;
      $('undo').disabled = !game.pending.length;
      $('cancel').disabled = !placing;
      $('reveal').disabled = !canReveal;
      $('turn').disabled = !canTurn;
      $('headline').textContent = headline;
      $('hint').textContent = hint;
      $('pattern').hidden = !pattern;
      $('pattern').replaceChildren(...(pattern ?? []).map(patternTile));
      $('message').textContent = message?.text ?? '';
      $('message').className = message?.tone ?? '';
    },
  };
}
