// Builds a word checker from a newline-separated word list.
export function createDictionary(text) {
  const words = new Set(text.split('\n').map((word) => word.trim().toUpperCase()));
  return (word) => words.has(word.toUpperCase());
}
