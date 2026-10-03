// Lists every vantage point in a level and the lines that join there.
// Usage: npm run vantages
import { buildBoard, chainsForView, isJoined } from '../src/board.js';
import { BROKEN_CUBE } from '../src/level.js';

const board = buildBoard(BROKEN_CUBE);
console.log(
  `${board.cells.length} blocks, ${board.slots.size} slots, ${board.lines.length} lines, ` +
    `${board.vantages.length} vantage points\n`,
);

const label = (d) => {
  const largest = Math.max(...d.map(Math.abs));
  return `(${d.map((v) => Math.round(v / largest)).join(', ')})`;
};
const describe = (line) => {
  const first = board.slots.get(line.slots[0]);
  return `${line.slots.length} on ${line.face} from [${first.cell}]`;
};

for (const vantage of board.vantages) {
  const joined = chainsForView(board, vantage.dir).chains.filter(isJoined);
  console.log(label(vantage.dir));
  for (const chain of joined) {
    const parts = chain.cyclic ? 'closed loop' : chain.lines.map((id) => describe(board.lines[id])).join(' + ');
    console.log(`  ${chain.slots.length} tiles: ${parts}`);
  }
}
