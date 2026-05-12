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

/**
 * MIIO-level error codes returned by the device daemon (encrypted JSON
 * `{"error":{"code":N,"message":"..."}}`) that historically respond to
 * a fresh handshake / new source port. Treated as retryable but with a
 * tight per-call retry cap so we do not hammer a genuinely broken device.
 *
 * - `-5001` "command error" — most common, observed on `zhimi.airpurifier.pro`
 *   after long uptime; daemon rejects all commands until source port rotates.
 * - `-10000` "Method execution error" — generic firmware-side failure.
 */
export const MIIO_COMMAND_RETRY_CODES = new Set<string>(["-5001", "-10000"]);

export const DEVICE_UNAVAILABLE_MAX_RETRIES = 2;
export const MIIO_COMMAND_MAX_RETRIES = 2;

const errorCode = (error: unknown): string | undefined => {
  if (!(error instanceof Error)) {
    return undefined;
  }

  const code = (error as unknown as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
};

export const isRetryableError = (error: unknown): boolean => {
  const code = errorCode(error);
  if (code === undefined) {
    return false;
  }

  return RETRYABLE_ERROR_CODES.has(code) || MIIO_COMMAND_RETRY_CODES.has(code);
};

export const effectiveMaxRetries = (
  error: unknown,
  policyMaxRetries: number,
): number => {
  const code = errorCode(error);
  if (code === "EDEVICEUNAVAILABLE") {
    return Math.min(DEVICE_UNAVAILABLE_MAX_RETRIES, policyMaxRetries);
  }

  if (code !== undefined && MIIO_COMMAND_RETRY_CODES.has(code)) {
    return Math.min(MIIO_COMMAND_MAX_RETRIES, policyMaxRetries);
  }

  return policyMaxRetries;
};
