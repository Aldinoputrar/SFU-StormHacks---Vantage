import { dot, screenBasis, sub } from './geometry.js';
import { isJoined } from './board.js';

// At an intersection, start across when available. The alternative remains
// explicit in the direction switch, rather than choosing whichever is longest.
export function placementOptions(board, view, key, viewDir) {
  const across = (chain) => placementDirection(board, chain, viewDir).startsWith('Across');
  return (view.bySlot.get(key) ?? [])
    .filter((chain) => chain.slots.length >= 2)
    .sort((a, b) => Number(across(b)) - Number(across(a)) ||
      Number(isJoined(b)) - Number(isJoined(a)) || b.slots.length - a.slots.length);
}

// Describe the actual reading direction on screen, not the strip's world axis.
export function placementDirection(board, chain, viewDir) {
  if (chain.cyclic) return 'Clockwise ↻';
  if (chain.slots.length < 2) return 'Single tile';
  const { right, up } = screenBasis(viewDir);
  const step = sub(board.slots.get(chain.slots[1]).center, board.slots.get(chain.slots[0]).center);
  const x = dot(step, right);
  const y = dot(step, up);
  const size = Math.hypot(x, y);
  if (size < 1e-9) return 'Overlapping tiles';
  if (Math.abs(x) < 0.3 * size) return y < 0 ? 'Down ↓' : 'Up ↑';
  if (Math.abs(y) < 0.3 * size) return x > 0 ? 'Across →' : 'Across ←';
  return `Diagonal ${x > 0 ? (y > 0 ? '↗' : '↘') : (y > 0 ? '↖' : '↙')}`;
}
