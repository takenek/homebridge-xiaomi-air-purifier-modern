/**
 * Minimal logger surface used throughout the plugin. It mirrors the subset
 * of Homebridge's `Logging` interface that the plugin actually calls, while
 * staying decoupled from Homebridge types so the core (`src/core`) layers can
 * be unit-tested without pulling in Homebridge. Methods are variadic so that
 * Homebridge's printf-style formatting (`"%s"`, ...) keeps working when a
 * scoped logger is passed where a raw `Logging` was used before.
 */
export interface ScopedLogger {
  debug(message: string, ...parameters: unknown[]): void;
  info(message: string, ...parameters: unknown[]): void;
  warn(message: string, ...parameters: unknown[]): void;
  error(message: string, ...parameters: unknown[]): void;
}

// A-07 (CWE-117): neutralize CR/LF and other C0/C1 control characters before a
// line reaches the log sink. Untrusted values — the configured device name and
// device-supplied `error.message` — flow into these lines; without this a
// crafted value could forge extra log entries or corrupt terminal output.
// Applied centrally because every device-scoped line passes through this logger.
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally matches control characters to strip them from log output.
const LOG_CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

export const sanitizeLogMessage = (message: string): string =>
  message.replace(LOG_CONTROL_CHARS, " ");

/**
 * Wrap a base logger so that every line is prefixed with a device label, e.g.
 * `[Bedroom] Device read failed ...`.
 *
 * With multiple purifiers configured, the low-level transport/poll messages
 * are otherwise byte-for-byte identical across instances, making it impossible
 * to tell which device a given log line refers to. Homebridge's own log prefix
 * is the *plugin* name (shared by every device of this platform), so the
 * per-device label has to be added here.
 *
 * The label and every message are sanitized (A-07) so an untrusted device name
 * or device-supplied error text cannot inject control characters into the log.
 */
export const createScopedLogger = (
  base: ScopedLogger,
  label: string,
): ScopedLogger => {
  const prefix = `[${sanitizeLogMessage(label)}] `;

  return {
    debug: (message: string, ...parameters: unknown[]): void => {
      base.debug(`${prefix}${sanitizeLogMessage(message)}`, ...parameters);
    },
    info: (message: string, ...parameters: unknown[]): void => {
      base.info(`${prefix}${sanitizeLogMessage(message)}`, ...parameters);
    },
    warn: (message: string, ...parameters: unknown[]): void => {
      base.warn(`${prefix}${sanitizeLogMessage(message)}`, ...parameters);
    },
    error: (message: string, ...parameters: unknown[]): void => {
      base.error(`${prefix}${sanitizeLogMessage(message)}`, ...parameters);
    },
  };
};
