// The turntable: one floating ledge that a player can turn a quarter turn
// about the vertical axis through its first block, spending a turn to
// reshape the structure and open up new lines.

const cellKey = (cell) => cell.join(',');

// A quarter turn about +y, matching a Three.js rotation.y of +90°.
const quarterTurn = ([x, y, z]) => [z, y, -x];

function turn(v, quarters) {
  for (let i = 0; i < quarters % 4; i++) v = quarterTurn(v);
  return v;
}

export const turntableOf = (level) => level.blocks.find((block) => block.turntable);

// The level with its turntable turned the given number of quarter turns.
export function turnedLevel(level, quarters) {
  const blocks = level.blocks.map((block) => {
    if (!block.turntable) return block;
    const pivot = block.start;
    return { ...block, start: pivot, dir: turn(block.dir, quarters) };
  });
  return { ...level, blocks };
}

export function turntableCells(level) {
  const block = turntableOf(level);
  if (!block) return new Set();
  return new Set(
    Array.from({ length: block.length }, (_, i) => cellKey(block.start.map((v, j) => v + block.dir[j] * i))),
  );
}

// Where a cell and face normal on the turntable end up after one more
// quarter turn.
export function turnOnce(level, cell, normal) {
  const pivot = turntableOf(level).start;
  const offset = turn(
    cell.map((v, i) => v - pivot[i]),
    1,
  );
  return { cell: offset.map((v, i) => v + pivot[i]), normal: quarterTurn(normal) };
}
