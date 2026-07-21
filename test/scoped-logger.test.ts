import { describe, expect, it, vi } from "vitest";
import {
  createScopedLogger,
  sanitizeLogMessage,
} from "../src/core/scoped-logger";

const makeBase = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe("createScopedLogger", () => {
  it("prefixes every level with the device label", () => {
    const base = makeBase();
    const log = createScopedLogger(base, "Bedroom");

    log.debug("debug line");
    log.info("info line");
    log.warn("warn line");
    log.error("error line");

    expect(base.debug).toHaveBeenCalledWith("[Bedroom] debug line");
    expect(base.info).toHaveBeenCalledWith("[Bedroom] info line");
    expect(base.warn).toHaveBeenCalledWith("[Bedroom] warn line");
    expect(base.error).toHaveBeenCalledWith("[Bedroom] error line");
  });

  it("forwards printf-style parameters unchanged", () => {
    const base = makeBase();
    const log = createScopedLogger(base, "Living Room");

    log.debug("Removing stale service: %s (subtype: %s)", "LED", "led");

    expect(base.debug).toHaveBeenCalledWith(
      "[Living Room] Removing stale service: %s (subtype: %s)",
      "LED",
      "led",
    );
  });

  it("keeps each device's label isolated from the others", () => {
    const base = makeBase();
    const bedroom = createScopedLogger(base, "Bedroom");
    const office = createScopedLogger(base, "Office");

    bedroom.warn("Device read failed");
    office.warn("Device read failed");

    expect(base.warn).toHaveBeenNthCalledWith(
      1,
      "[Bedroom] Device read failed",
    );
    expect(base.warn).toHaveBeenNthCalledWith(2, "[Office] Device read failed");
  });

  it("neutralizes control characters in the label and every message (A-07)", () => {
    const base = makeBase();
    const log = createScopedLogger(base, "Bed\r\nroom");

    log.info("device said: ok\r\nFAKE ERROR line");

    // Both the injected CR/LF in the label and in the message are collapsed to
    // spaces, so a crafted name or device error text cannot forge a log line.
    expect(base.info).toHaveBeenCalledWith(
      "[Bed  room] device said: ok  FAKE ERROR line",
    );
  });
});

describe("sanitizeLogMessage", () => {
  it("replaces CR, LF and other control characters with spaces (A-07)", () => {
    expect(sanitizeLogMessage("line1\r\nline2\tend")).toBe("line1  line2 end");
    expect(sanitizeLogMessage("clean text")).toBe("clean text");
  });
});
