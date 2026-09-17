/**
 * ── AI ENGINEERING CONCEPT: not all failures deserve the same reaction ──
 *
 * A naive integration treats every error from an LLM call the same way:
 * catch, log, give up. In production you need to know WHICH KIND of
 * failure happened, because the right response is different for each:
 *
 *   - The network blipped, or you hit a rate limit → this is TRANSIENT.
 *     Waiting a bit and trying again usually just works. Retrying is free
 *     upside here.
 *   - The model refused the request (safety/policy reasons) → retrying
 *     the exact same prompt will almost always fail the exact same way.
 *     Burning API credits on that is pure waste — fail fast instead.
 *   - The model's response didn't match our schema (a hallucinated field,
 *     a wrong enum value, a wrong array length) → this is a GRAY AREA.
 *     It might be a one-off slip, so retrying can help — but blindly
 *     resending the same prompt often reproduces the same mistake. The
 *     better move is to show the model exactly what was wrong and ask it
 *     to fix that specific thing (a "self-correction" loop) — see
 *     StructuredOutputValidationError and how
 *     run-structured-openrouter-agent.ts uses it.
 *
 * Modeling these as distinct error CLASSES (instead of one generic Error)
 * lets calling code make that decision with a simple `instanceof` check —
 * see retry-policy.ts's `classify` parameter — rather than guessing from
 * an error message string, which is brittle and easy to get wrong.
 */

/** A failure that's likely to succeed if retried unchanged: network
 * errors, timeouts, a short-lived per-minute rate limit (HTTP 429/5xx-class
 * problems). NOT every 429 belongs here — see QuotaExceededError below for
 * the one that doesn't. */
export class TransientAgentError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TransientAgentError";
  }
}

/** OpenRouter's free-tier ACCOUNT-WIDE daily request quota is exhausted
 * (HTTP 429, message body contains "free-models-per-day") — a genuinely
 * different failure from a short-lived per-minute rate limit, even though
 * both arrive as the same openai SDK RateLimitError class. Retrying does
 * NOT help here: per OpenRouter's own docs, a FAILED attempt still counts
 * against the daily quota, so blind retries (the TransientAgentError
 * treatment) just dig the hole deeper and burn through whatever quota is
 * left even faster. Learned the hard way (see docs/ARCHITECTURE.md's
 * "Known limitation" section for the incident). The fix is always
 * external — wait for the rolling 24h window, or add credits — never
 * something a retry from this process can resolve. */
export class QuotaExceededError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "QuotaExceededError";
  }
}

/** The model declined to complete the request (policy/safety). Retrying
 * the identical prompt wastes money — this is NOT retried automatically. */
export class AgentRefusalError extends Error {
  constructor(
    message: string,
    public readonly subtype: string,
  ) {
    super(message);
    this.name = "AgentRefusalError";
  }
}

/** The agent's final answer didn't match our zod schema. Carries the
 * actual validation messages so a retry can hand them back to the model
 * as corrective feedback instead of just trying the same prompt again. */
export class StructuredOutputValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: string[],
  ) {
    super(message);
    this.name = "StructuredOutputValidationError";
  }
}
