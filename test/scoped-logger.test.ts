import { describe, expect, it, vi } from "vitest";
import { createScopedLogger } from "../src/core/scoped-logger";

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
});
