/**
 * ARIES v5.0 — Rate Limiter
 * Token bucket algorithm with per-IP and per-token tracking.
 */

class RateLimiter {
  constructor(opts = {}) {
    this.maxPerMinute = opts.maxPerMinute || 60;
    this.burst = opts.burst || 10;
    this._buckets = new Map(); // key → { tokens, lastRefill }
    
    // Cleanup old buckets every 5 minutes
    this._cleanup = setInterval(() => {
      const now = Date.now();
      for (const [key, bucket] of this._buckets) {
        if (now - bucket.lastRefill > 300000) this._buckets.delete(key);
      }
    }, 300000);
  }

  /** Check if request is allowed. Returns { allowed, remaining, retryAfterMs } */
  check(key) {
    const now = Date.now();
    let bucket = this._buckets.get(key);
    
    if (!bucket) {
      bucket = { tokens: this.burst, lastRefill: now };
      this._buckets.set(key, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill;
    const refill = Math.floor(elapsed / 60000 * this.maxPerMinute);
    if (refill > 0) {
      bucket.tokens = Math.min(this.burst, bucket.tokens + refill);
      bucket.lastRefill = now;
    }

    if (bucket.tokens > 0) {
      bucket.tokens--;
      return { allowed: true, remaining: bucket.tokens, retryAfterMs: 0 };
    }

    const retryAfterMs = Math.ceil(60000 / this.maxPerMinute);
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  destroy() {
    if (this._cleanup) clearInterval(this._cleanup);
  }
}

module.exports = RateLimiter;
