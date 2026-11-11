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

describe("the server and requests it did not expect", () => {
  async function withServer<T>(fn: (base: string, port: number) => Promise<T>): Promise<T> {
    const { createApp } = await import("./index.js");
    const server = createApp();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      return await fn(`http://127.0.0.1:${port}`, port);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  /** A raw request, for the things `fetch` will not send. */
  async function raw(port: number, text: string): Promise<string> {
    const { connect } = await import("node:net");
    return new Promise((resolve, reject) => {
      const socket = connect(port, "127.0.0.1", () => socket.write(text));
      let out = "";
      socket.on("data", (d) => (out += String(d)));
      socket.on("end", () => resolve(out));
      socket.on("error", reject);
    });
  }

  it("survives a malformed path, a malformed Host and a directory", async () => {
    await withServer(async (base, port) => {
      await raw(port, "GET // HTTP/1.1\r\nHost: a b\r\nConnection: close\r\n\r\n");
      await raw(port, "GET http:// HTTP/1.1\r\nHost: [\r\nConnection: close\r\n\r\n");
      expect((await fetch(`${base}/dist`)).status).toBe(404);
      // Still serving.
      expect((await fetch(`${base}/api/meta`)).status).toBe(200);
    });
  });

  it("refuses to start a run for another site's page", async () => {
    await withServer(async (base) => {
      const cross = await fetch(`${base}/api/run?brief=x&demo=1`, { headers: { "sec-fetch-site": "cross-site" } });
      expect(cross.status).toBe(403);
      const rebound = await fetch(`${base}/api/run?brief=x&demo=1`, { headers: { origin: "http://evil.example" } });
      expect(rebound.status).toBe(403);
    });
  });

  it("tells an event-stream client why a run was turned down", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/run?brief=`, { headers: { accept: "text/event-stream" } });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("Pass either a known task id or a non-empty brief.");
      expect((await fetch(`${base}/api/run?brief=`)).status).toBe(400);
    });
  });
});
