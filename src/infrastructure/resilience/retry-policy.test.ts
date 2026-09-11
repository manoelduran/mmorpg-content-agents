import { test } from "node:test";
import assert from "node:assert/strict";
import { withRetry, type RetryPolicy } from "./retry-policy";

// Tiny delays so the test suite stays fast — we're testing the RETRY
// COUNT/DECISION logic here, not real-world backoff timing.
const FAST_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 1,
  maxDelayMs: 2,
  backoffFactor: 2,
};

test("withRetry: succeeds immediately without retrying when fn succeeds on the first try", async () => {
  let calls = 0;
  const result = await withRetry(
    "input",
    async (input) => {
      calls++;
      return `ok:${input}`;
    },
    () => ({ retryable: true, nextInput: "input" }),
    FAST_POLICY,
  );

  assert.equal(result, "ok:input");
  assert.equal(calls, 1);
});

test("withRetry: retries up to maxAttempts on a retryable error, then throws", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        "input",
        async () => {
          calls++;
          throw new Error("always fails");
        },
        () => ({ retryable: true, nextInput: "input" }),
        FAST_POLICY,
      ),
    /always fails/,
  );

  assert.equal(calls, FAST_POLICY.maxAttempts);
});

test("withRetry: stops immediately on a non-retryable error, without exhausting maxAttempts", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        "input",
        async () => {
          calls++;
          throw new Error("non-retryable");
        },
        () => ({ retryable: false, nextInput: "input" }),
        FAST_POLICY,
      ),
    /non-retryable/,
  );

  assert.equal(calls, 1);
});

test("withRetry: succeeds on a later attempt after transient failures", async () => {
  let calls = 0;
  const result = await withRetry(
    "input",
    async () => {
      calls++;
      if (calls < 2) throw new Error("transient");
      return "recovered";
    },
    () => ({ retryable: true, nextInput: "input" }),
    FAST_POLICY,
  );

  assert.equal(result, "recovered");
  assert.equal(calls, 2);
});

test("withRetry: classify can rewrite the input between attempts (self-correction)", async () => {
  const seenInputs: string[] = [];
  const result = await withRetry(
    "attempt-1",
    async (input) => {
      seenInputs.push(input);
      if (input === "attempt-1") throw new Error("needs correction");
      return `ok:${input}`;
    },
    (_error, input) => ({ retryable: true, nextInput: `${input}-corrected` }),
    FAST_POLICY,
  );

  assert.equal(result, "ok:attempt-1-corrected");
  assert.deepEqual(seenInputs, ["attempt-1", "attempt-1-corrected"]);
});
