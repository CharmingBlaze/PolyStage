/** Stable undirected edge key from two vertex IDs. */
export function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function edgeIdFromKey(key: string): string {
  return `e_${key}`;
}

export function makeEdgeId(a: string, b: string): string {
  return edgeIdFromKey(edgeKey(a, b));
}

let idCounter = 0;

/**
 * Unique ID with an optional semantic prefix (`generateId('v')` -> `v_3f2a1b_12`).
 * The monotonic suffix guarantees uniqueness even when two IDs are minted in the
 * same millisecond, which plain `Math.random()` cannot.
 */
export function generateId(prefix?: string): string {
  const body = `${Math.random().toString(36).slice(2, 9)}_${(idCounter++).toString(36)}`;
  return prefix ? `${prefix}_${body}` : body;
}
