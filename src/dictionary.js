// Word checking. Words are looked up in Merriam-Webster's Scrabble
// dictionary (scrabble.merriam.com) through the /mw proxy set up in
// vite.config.js (and in vercel.json / public/_redirects when deployed), so
// the browser is not blocked by cross-origin rules. If the site cannot be
// reached or its page cannot be read, the offline word list decides.

const MERRIAM_TIMEOUT_MS = 6000;
const STORAGE_KEY = 'vantage-checked-words';

// Builds a word checker from a newline-separated word list.
export function createDictionary(text) {
  const words = new Set(text.split('\n').map((word) => word.trim().toUpperCase()));
  return (word) => words.has(word.toUpperCase());
}

// Reads Merriam-Webster's page for a word: true if it says the word is
// playable, false if it says it is not, null if the page does not say.
export function readMerriamPage(html, word, status = 200) {
  if (status === 404) return false;
  if (status < 200 || status >= 300) return null; // an error page says nothing about the word
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&#39;|&rsquo;/gi, "'")
    .replace(/\s+/g, ' ')
    .toLowerCase();
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  // A phrase shortly after the word, within the same sentence.
  const after = (phrase) => new RegExp(`\\b${w}\\b[^.!?]{0,60}?${phrase}`).test(text);

  if (after("(?:is not|isn't|not)\\s+(?:a\\s+)?(?:valid|playable|acceptable|in the)")) return false;
  if (after('(?:is|are)\\s+(?:a\\s+)?(?:valid|playable|acceptable)')) return true;
  if (/\bno results\b|\bnot found\b|\bdid you mean\b|\b0 results\b/.test(text)) return false;
  if (after('\\b(?:valid|playable)\\b')) return true;
  return null;
}

async function fetchMerriamPage(word) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MERRIAM_TIMEOUT_MS);
  try {
    const response = await fetch(`/mw/finder/${encodeURIComponent(word.toLowerCase())}`, {
      signal: controller.signal,
    });
    return { status: response.status, html: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

function loadCache() {
  try {
    return new Map(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'));
  } catch {
    return new Map();
  }
}

function saveCache(cache) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...cache]));
  } catch {
    // Private windows can refuse storage; checks are just repeated then.
  }
}

// Checks words against Merriam-Webster, then the offline list. Answers are
// cached so a word is only looked up once. fetchPage and loadOffline can be
// swapped out for tests.
export function createWordChecker({ fetchPage = fetchMerriamPage, loadOffline, storage = true } = {}) {
  const cache = storage ? loadCache() : new Map(); // word -> { valid, source }
  const inFlight = new Map(); // word -> promise of an answer
  let offline = null;

  async function lookUp(word) {
    try {
      const { status, html } = await fetchPage(word);
      const valid = readMerriamPage(html, word, status);
      if (valid !== null) {
        cache.set(word, { valid, source: 'Merriam-Webster' });
        if (storage) saveCache(cache);
        return { word, ...cache.get(word) };
      }
    } catch {
      // Offline, blocked or timed out: the offline list decides.
    }
    offline ??= loadOffline().catch((error) => {
      offline = null; // try downloading the list again next time
      throw error;
    });
    const isWord = await offline;
    return { word, valid: isWord(word), source: 'offline list' };
  }

  function check(word) {
    const key = word.toUpperCase();
    if (cache.has(key)) return Promise.resolve({ word: key, ...cache.get(key) });
    if (!inFlight.has(key)) inFlight.set(key, lookUp(key).finally(() => inFlight.delete(key)));
    return inFlight.get(key);
  }

  return { check, checkAll: (words) => Promise.all(words.map(check)) };
}
