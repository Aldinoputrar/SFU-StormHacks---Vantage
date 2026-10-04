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

function patternTile({ letter, pending, cursor, joint, bonus, covered }, index) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.index = index;
  button.textContent = letter || bonus || '';
  button.setAttribute('aria-label', `Square ${index + 1}: ${letter || bonus || 'empty'}${covered ? ', covered by another block' : ''}`);
  button.setAttribute('aria-pressed', String(cursor));
  button.title = covered ? 'Covered square — still part of this row' : `Start at square ${index + 1}`;
  if (bonus) button.dataset.bonus = bonus;
  button.classList.toggle('letter', Boolean(letter));
  button.classList.toggle('pending', pending);
  button.classList.toggle('cursor', cursor);
  button.classList.toggle('joint', joint);
  button.classList.toggle('covered', covered);
  return button;
}

// Counts the score up to its new value, rather than jumping, and bumps it.
let shownScore = 0;
let scoreFrame = 0;
function showScore(element, score) {
  if (score === shownScore) return;
  cancelAnimationFrame(scoreFrame);
  const from = shownScore;
  const start = performance.now();
  shownScore = score;
  element.classList.remove('bump');
  void element.offsetWidth; // restart the animation
  element.classList.add('bump');
  const step = (now) => {
    const t = Math.min(1, (now - start) / 700);
    element.textContent = Math.round(from + (score - from) * (1 - (1 - t) ** 3));
    if (t < 1) scoreFrame = requestAnimationFrame(step);
  };
  scoreFrame = requestAnimationFrame(step);
}

// Re-rendering a clicked row must not lose keyboard focus.
function replaceTiles(element, tiles) {
  const focused = element.contains(document.activeElement) ? document.activeElement.dataset.index : null;
  element.replaceChildren(...tiles);
  if (focused != null) element.querySelector(`[data-index="${focused}"]`)?.focus({ preventScroll: true });
}

export function createHud({
  onRack,
  onPlay,
  onUndo,
  onCancel,
  onIso,
  onOverhead,
  onReveal,
  onPattern,
  onSwitchLine,
  onSwap,
  onFinish,
  onSwing,
}) {
  $('score').textContent = '0';
  $('play').addEventListener('click', onPlay);
  $('undo').addEventListener('click', onUndo);
  $('cancel').addEventListener('click', onCancel);
  $('iso').addEventListener('click', onIso);
  $('overhead').addEventListener('click', onOverhead);
  $('reveal').addEventListener('click', onReveal);
  $('switch-line').addEventListener('click', onSwitchLine);
  $('swap').addEventListener('click', onSwap);
  $('finish').addEventListener('click', onFinish);
  $('swing').addEventListener('click', onSwing);
  $('pattern').addEventListener('click', (event) => {
    const tile = event.target.closest('[data-index]');
    if (tile && !tile.disabled) onPattern(Number(tile.dataset.index));
  });
  $('rack').addEventListener('click', (event) => {
    const tile = event.target.closest('[data-index]');
    if (tile && !tile.disabled) onRack(Number(tile.dataset.index));
  });

  return {
    // busy: the camera is moving, the chamber is open or words are being
    // checked. canPlace: a line is chosen and tiles can go on it.
    render({ game, placing, busy, over, canPlace, canIso, canReveal, canSwing, canSwitch, switchLabel, headline, hint, pattern, message }) {
      showScore($('score'), game.score);
      $('swing').disabled = !canSwing;
      $('turns').textContent = game.turnsLeft;
      $('bag').textContent = game.bag.length;
      replaceTiles(
        $('rack'),
        game.rack.map((letter, index) => {
          const tile = rackTile(letter, index);
          tile.disabled = !canPlace;
          return tile;
        }),
      );
      $('rack').classList.toggle('idle', !placing);
      $('play').disabled = !canPlace || !game.pending.length;
      $('undo').disabled = !canPlace || !game.pending.length;
      $('cancel').disabled = busy || !placing;
      $('iso').disabled = !canIso;
      $('overhead').disabled = !canIso;
      $('reveal').disabled = !canReveal;
      $('swap').disabled = busy || over || placing || !game.rack.length;
      $('finish').disabled = busy || over;
      $('switch-line').hidden = !canSwitch;
      $('switch-line').textContent = switchLabel;
      $('switch-line').disabled = busy || Boolean(game.pending.length);
      $('headline').textContent = headline;
      $('hint').textContent = hint;
      $('pattern').hidden = !pattern;
      replaceTiles(
        $('pattern'),
        (pattern ?? []).map((square, index) => {
          const tile = patternTile(square, index);
          tile.disabled = !canPlace;
          return tile;
        }),
      );
      $('message').textContent = message?.text ?? '';
      $('message').className = message?.tone ?? '';
    },
  };
}
