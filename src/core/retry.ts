export interface RetryPolicy {
  baseDelayMs: number;
  maxDelayMs: number;
  maxRetries: number;
  jitterFactor: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  baseDelayMs: 400,
  maxDelayMs: 30_000,
  maxRetries: 8,
  jitterFactor: 0.2,
};

export const computeBackoffDelay = (
  attempt: number,
  policy: RetryPolicy,
  randomFn: () => number = Math.random,
): number => {
  const exp = policy.baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(exp, policy.maxDelayMs);
  const jitterRange = capped * policy.jitterFactor;
  const jitter = (randomFn() * 2 - 1) * jitterRange;
  return Math.max(0, Math.round(capped + jitter));
};

// Network/device errors that are transient and worth retrying.
// Local socket binding errors (EADDRINUSE, EADDRNOTAVAIL) are intentionally
// excluded – they indicate a local misconfiguration and retrying won't help.
export const RETRYABLE_ERROR_CODES = new Set<string>([
  "EDEVICEUNAVAILABLE",
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "EPIPE",
  "ENOTCONN",
  "EINTR",
  "EALREADY",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENETDOWN",
  "ENETRESET",
  "EAI_AGAIN",
  "ENOTFOUND",
  "ERR_NETWORK_CHANGED",
]);

export const isRetryableError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = Reflect.get(error, "code");
  if (typeof code === "string") {
    return RETRYABLE_ERROR_CODES.has(code);
  }

  return false;
};
