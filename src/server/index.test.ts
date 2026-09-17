/**
 * The server's own module graph has to register a rasterizer.
 *
 * `/api/run` defaults to the `both` feedback mode, and `createFeedbackChannel`
 * refuses an image mode when nothing is registered — so a server that never
 * imports a backend fails every run it serves, with a message telling the
 * operator to import a file they are not editing.
 *
 * The suite cannot see that by default: `vitest.config.ts` installs
 * `src/render/raster.ts` as a setup file, so a rasterizer is registered for
 * every test file whether or not the code under test asks for one. The reset
 * below drops that registration and rebuilds the graph from the server entry
 * alone, which is what `npm run serve` actually loads.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FEEDBACK_MODES } from "../feedback/index.js";

describe("the server entry point", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("registers a rasterizer by importing it", async () => {
    // A fresh registry instance, so the setup file's registration is not what
    // is being measured.
    const { hasRasterizer } = await import("../render/rasterizer.js");
    expect(hasRasterizer()).toBe(false);

    await import("./index.js");

    expect(hasRasterizer()).toBe(true);
  });

  it("can build the feedback channel /api/run defaults to", async () => {
    await import("./index.js");
    const { createFeedbackChannel } = await import("../feedback/index.js");

    // The default in `handleRun`; the one an operator hits without touching
    // the menu.
    expect(() => createFeedbackChannel("both")).not.toThrow();
  });

  it("offers only feedback modes it can actually serve", async () => {
    await import("./index.js");
    const { availableFeedbackModes } = await import("../feedback/index.js");

    // The menu the page is handed comes from `FEEDBACK_MODES`, so every mode
    // in it must be one this process can build.
    expect(availableFeedbackModes()).toEqual([...FEEDBACK_MODES]);
  });
});
