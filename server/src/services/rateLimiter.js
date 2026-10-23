/**
 * Fixed-window counter kept in memory. A restart resets the counters, which
 * is acceptable for abuse throttling but is not a security boundary.
 */
export function createRateLimiter({ windowMs, max, now = () => Date.now() }) {
  const buckets = new Map();
  let lastSweep = now();
  return {
    hit(key) {
      const t = now();
      if (t - lastSweep > windowMs * 2) {
        for (const [k, b] of buckets) if (t - b.start >= windowMs) buckets.delete(k);
        lastSweep = t;
      }
      let b = buckets.get(key);
      if (!b || t - b.start >= windowMs) {
        b = { start: t, count: 0 };
        buckets.set(key, b);
      }
      b.count += 1;
      return { allowed: b.count <= max, retryAfterMs: Math.max(0, windowMs - (t - b.start)) };
    },
    /** True when the key already used up its window, without counting a hit. */
    blocked(key) {
      const b = buckets.get(key);
      return Boolean(b && now() - b.start < windowMs && b.count >= max);
    },
    reset(key) { buckets.delete(key); },
  };
}
