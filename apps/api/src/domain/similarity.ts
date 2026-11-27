/** Written-answer collusion detection: Jaccard similarity of word 3-gram shingles. */
const normalise = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

export function shingles(text: string, k = 3) {
  const w = normalise(text);
  const set = new Set<string>();
  if (w.length < k) {
    if (w.length) set.add(w.join(' '));
    return set;
  }
  for (let i = 0; i <= w.length - k; i++) set.add(w.slice(i, i + k).join(' '));
  return set;
}

export function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  a.forEach((x) => b.has(x) && inter++);
  return inter / (a.size + b.size - inter);
}
