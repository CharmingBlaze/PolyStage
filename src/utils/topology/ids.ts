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

export function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}
