/**
 * Token-bucket / sliding-window rate limiter (per-user).
 * Default: 10 requests per minute per user.
 */

interface UserBucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private buckets = new Map<string, UserBucket>();
  private violations = 0;
  private readonly windowMs: number;
  private readonly limit: number;

  constructor(limitPerMinute: number, windowMs = 60_000) {
    this.limit = Math.max(1, limitPerMinute);
    this.windowMs = windowMs;
  }

  /** Returns { allowed, retryAfterSec } without recording the request. */
  checkLimit(userId: string): { allowed: boolean; retryAfterSec: number; remaining: number } {
    const now = Date.now();
    const b = this.buckets.get(userId);
    if (!b || now >= b.resetAt) {
      return { allowed: true, retryAfterSec: 0, remaining: this.limit };
    }
    if (b.count >= this.limit) {
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)),
        remaining: 0,
      };
    }
    return { allowed: true, retryAfterSec: 0, remaining: this.limit - b.count };
  }

  /** Records a request for the user. Returns updated state. */
  recordRequest(userId: string): { allowed: boolean; retryAfterSec: number; remaining: number } {
    const now = Date.now();
    let b = this.buckets.get(userId);
    if (!b || now >= b.resetAt) {
      b = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(userId, b);
    }
    b.count++;
    if (b.count > this.limit) {
      this.violations++;
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)),
        remaining: 0,
      };
    }
    return { allowed: true, retryAfterSec: 0, remaining: this.limit - b.count };
  }

  reset(userId?: string): void {
    if (userId) this.buckets.delete(userId);
    else this.buckets.clear();
  }

  getViolations(): number {
    return this.violations;
  }
}
