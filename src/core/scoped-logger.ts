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

/**
 * Wrap a base logger so that every line is prefixed with a device label, e.g.
 * `[Bedroom] Device read failed ...`.
 *
 * With multiple purifiers configured, the low-level transport/poll messages
 * are otherwise byte-for-byte identical across instances, making it impossible
 * to tell which device a given log line refers to. Homebridge's own log prefix
 * is the *plugin* name (shared by every device of this platform), so the
 * per-device label has to be added here.
 */
export const createScopedLogger = (
  base: ScopedLogger,
  label: string,
): ScopedLogger => {
  const prefix = `[${label}] `;

  return {
    debug: (message: string, ...parameters: unknown[]): void => {
      base.debug(`${prefix}${message}`, ...parameters);
    },
    info: (message: string, ...parameters: unknown[]): void => {
      base.info(`${prefix}${message}`, ...parameters);
    },
    warn: (message: string, ...parameters: unknown[]): void => {
      base.warn(`${prefix}${message}`, ...parameters);
    },
    error: (message: string, ...parameters: unknown[]): void => {
      base.error(`${prefix}${message}`, ...parameters);
    },
  };
};
