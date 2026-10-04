import { LETTER_VALUES } from './level.js';

// Hints: words the player could make on a line with the letters they hold.
// Nothing here touches the screen or the game; main.js tries the best few
// against the real rules (cross-words and all) before offering one.

// A word list for hints, from the newline-separated offline list: upper
// case, and only lengths a line could hold.
export function hintWords(text, longest = 15) {
  return text
    .split('\n')
    .map((word) => word.trim().toUpperCase())
    .filter((word) => word.length >= 2 && word.length <= longest);
}

// Words that fit on a line. pattern is the line's squares in reading order,
// a letter or '' for each; surfaces says which strip each square is on, so a
// word across two strips can be told apart. A fit must use at least one
// letter on the board and one from the rack, must not run into letters at
// either end, and must not need more of a letter than the rack holds.
// Returns fits best first: words across the gap, then by letter values.
export function findFits(pattern, rack, words, surfaces = []) {
  const n = pattern.length;
  const fixed = pattern.join('');
  if (!fixed || fixed.length === n) return [];
  const allowed = new Set([...rack, ...fixed]);
  const held = {};
  for (const letter of rack) held[letter] = (held[letter] ?? 0) + 1;
  const fits = [];

  for (const word of words) {
    if (word.length > n) continue;
    let possible = true;
    for (const letter of word) {
      if (!allowed.has(letter)) {
        possible = false;
        break;
      }
    }
    if (!possible) continue;

    for (let offset = 0; offset + word.length <= n; offset++) {
      if (pattern[offset - 1] || pattern[offset + word.length]) continue; // would join letters beyond its ends
      const need = {};
      const tiles = [];
      let onBoard = 0;
      let ok = true;
      for (let i = 0; i < word.length && ok; i++) {
        const there = pattern[offset + i];
        if (there) {
          if (there !== word[i]) ok = false;
          else onBoard++;
        } else {
          need[word[i]] = (need[word[i]] ?? 0) + 1;
          if (need[word[i]] > (held[word[i]] ?? 0)) ok = false;
          tiles.push({ index: offset + i, letter: word[i] });
        }
      }
      if (!ok || !onBoard || !tiles.length) continue;
      const spans = new Set(surfaces.slice(offset, offset + word.length)).size || 1;
      const value = [...word].reduce((sum, letter) => sum + LETTER_VALUES[letter], 0) * spans;
      fits.push({ word, offset, tiles, spans, value });
    }
  }
  return fits.sort((a, b) => b.spans - a.spans || b.value - a.value || b.word.length - a.word.length);
}
