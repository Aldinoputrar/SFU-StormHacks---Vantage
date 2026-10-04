// A leaderboard kept in this browser: the best scores on each map. Storage
// can be refused (private windows), so every read and write is guarded and
// the game works without it.

const KEY = 'vantage-leaderboard';
const KEEP = 50; // entries kept in all

export function loadScores(storage = globalThis.localStorage) {
  try {
    const entries = JSON.parse(storage?.getItem(KEY) ?? '[]');
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

// Records scores and returns the saved entries, so the caller can highlight
// them. entries: [{ name, score, map, words }].
export function saveScores(entries, storage = globalThis.localStorage, now = Date.now()) {
  const added = entries.filter((entry) => entry.score > 0).map((entry) => ({ ...entry, at: now }));
  const all = [...loadScores(storage), ...added].sort((a, b) => b.score - a.score || a.at - b.at).slice(0, KEEP);
  try {
    storage?.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage refused: the scores last for this visit only.
  }
  return added;
}

// The best scores on one map, with each one's place.
export function topScores(map, count = 5, storage = globalThis.localStorage) {
  return loadScores(storage)
    .filter((entry) => entry.map === map)
    .slice(0, count)
    .map((entry, i) => ({ ...entry, place: i + 1 }));
}
