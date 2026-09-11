/**
 * ── AI ENGINEERING CONCEPT: exponential backoff with jitter ──
 *
 * When a call fails because a service is overloaded (rate limit, 503),
 * retrying immediately makes things WORSE — you're adding load to a
 * system that just told you it's struggling. "Exponential backoff" means
 * each retry waits longer than the last (1s, 2s, 4s, 8s, ...) so you back
 * off in proportion to how much trouble you're causing.
 *
 * "Jitter" means adding a small random amount to each delay instead of a
 * perfectly round number. Without it, if TEN callers all get rate-limited
 * at the same moment, they'll all retry at exactly the same moments too
 * (1s, 2s, 4s...) — a synchronized wave that hits the service just as
 * hard as before. This is called the "thundering herd" problem. Jitter
 * spreads those retries out so they don't all land at once.
 *
 * This file is generic on purpose — it doesn't know anything about the
 * Claude Agent SDK or agents. It's a reusable resilience primitive any
 * infrastructure adapter can wrap a flaky call with.
 */

export interface RetryPolicy {
  /** Total attempts including the first — maxAttempts: 3 means "try, then
   * retry up to 2 more times" before giving up. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** How much the delay multiplies by after each failed attempt. */
  backoffFactor: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 15000,
  backoffFactor: 2,
};

function delayForAttempt(attempt: number, policy: RetryPolicy): number {
  // attempt is 1-indexed (the first retry is attempt 2, so it waits
  // baseDelayMs * backoffFactor^0 = baseDelayMs; the next waits
  // baseDelayMs * backoffFactor^1, and so on).
  const exponential = policy.baseDelayMs * Math.pow(policy.backoffFactor, attempt - 1);
  const capped = Math.min(exponential, policy.maxDelayMs);
  // Full jitter: a random delay anywhere between 0 and the capped value,
  // rather than the capped value itself — this is the AWS-recommended
  // jitter strategy, simple and effective at breaking up synchronized
  // retry waves.
  return Math.random() * capped;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fn`, retrying on failure according to `policy`. `classify` decides,
 * for a given error, whether it's worth retrying at all (see
 * agent-errors.ts's doc comment for the reasoning) and — critically — can
 * return a MODIFIED input for the next attempt (used for the
 * self-correction loop: feeding a schema validation error back into the
 * next prompt instead of blindly repeating the last one).
 */
export async function withRetry<TInput, TOutput>(
  input: TInput,
  fn: (input: TInput, attempt: number) => Promise<TOutput>,
  classify: (
    error: unknown,
    input: TInput,
    attempt: number,
  ) => { retryable: boolean; nextInput: TInput },
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<TOutput> {
  let currentInput = input;
  let lastError: unknown;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      return await fn(currentInput, attempt);
    } catch (error) {
      lastError = error;
      const decision = classify(error, currentInput, attempt);
      const isLastAttempt = attempt === policy.maxAttempts;

      if (!decision.retryable || isLastAttempt) {
        throw error;
      }

      currentInput = decision.nextInput;
      await sleep(delayForAttempt(attempt, policy));
    }
  }

  // Unreachable in practice (the loop always returns or throws), but
  // keeps TypeScript happy about every code path returning a value.
  throw lastError;
}
