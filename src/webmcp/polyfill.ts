/**
 * A minimal `document.modelContext` polyfill.
 *
 * No browser ships WebMCP yet, and the page must be drivable today — by the
 * end-to-end test in this repo, and by an external harness such as
 * webmcp-evals' browser mode. This implements the shape declared in
 * `webmcp-types` and nothing more.
 *
 * It installs itself only when `document.modelContext` is absent, so a browser
 * that does ship the real thing wins. `isPolyfilled()` says which is in play,
 * and the page states it, because "your results came from a polyfill" is
 * something a reader is entitled to know.
 */

export interface PolyfillToolDescriptor {
  name: string;
  title?: string;
  description: string;
  inputSchema?: object;
  execute: (input: Record<string, unknown>, options: { signal: AbortSignal }) => unknown | Promise<unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
    consequentialHint?: boolean;
  };
}

export interface PolyfillRegisteredTool {
  name: string;
  title: string;
  description: string;
  inputSchema?: object;
  window: unknown;
  origin: string;
  annotations?: PolyfillToolDescriptor["annotations"];
}

const POLYFILL_FLAG = "__canvasBenchWebmcpPolyfill";

class PolyfillModelContext extends EventTarget {
  private readonly tools = new Map<string, PolyfillToolDescriptor>();

  async registerTool(tool: PolyfillToolDescriptor, options?: { signal?: AbortSignal }): Promise<void> {
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(tool.name)) {
      throw new TypeError(`Invalid tool name '${tool.name}'.`);
    }
    this.tools.set(tool.name, tool);
    options?.signal?.addEventListener("abort", () => {
      if (this.tools.get(tool.name) === tool) {
        this.tools.delete(tool.name);
        this.dispatchEvent(new Event("toolchange"));
      }
    });
    this.dispatchEvent(new Event("toolchange"));
  }

  async getTools(): Promise<PolyfillRegisteredTool[]> {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      title: tool.title ?? tool.name,
      description: tool.description,
      // A deep copy, as the spec requires: a caller must not be able to reach
      // back through the returned descriptor and mutate what is registered.
      ...(tool.inputSchema ? { inputSchema: structuredClone(tool.inputSchema) } : {}),
      window: globalThis,
      origin: typeof location === "undefined" ? "null" : location.origin,
      ...(tool.annotations ? { annotations: { ...tool.annotations } } : {}),
    }));
  }

  async executeTool(
    tool: { name: string } | string,
    input: object = {},
    options: { signal?: AbortSignal } = {},
  ): Promise<string> {
    const name = typeof tool === "string" ? tool : tool.name;
    const descriptor = this.tools.get(name);
    if (!descriptor) throw new Error(`No registered tool named '${name}'.`);
    const controller = new AbortController();
    options.signal?.addEventListener("abort", () => controller.abort());
    const output = await descriptor.execute(input as Record<string, unknown>, { signal: controller.signal });
    // The spec types this as a string, so structured results are serialized.
    return typeof output === "string" ? output : JSON.stringify(output);
  }
}

/**
 * Install onto `document` (or any target, for tests). Returns true when the
 * polyfill was installed, false when a real implementation was already there
 * or there is no document at all.
 */
export function installWebMcpPolyfill(
  target: { modelContext?: unknown } | undefined = globalThis.document as unknown as { modelContext?: unknown },
): boolean {
  if (!target) return false;
  if (target.modelContext) return false;
  const context = new PolyfillModelContext();
  Object.defineProperty(context, POLYFILL_FLAG, { value: true, enumerable: false });
  Object.defineProperty(target, "modelContext", { value: context, configurable: true, enumerable: false });
  return true;
}

export function isPolyfilled(modelContext: unknown): boolean {
  return Boolean(modelContext && (modelContext as Record<string, unknown>)[POLYFILL_FLAG]);
}

/** A standalone context, for tests that should not touch a global document. */
export function createModelContext(): PolyfillModelContext {
  return new PolyfillModelContext();
}

export type { PolyfillModelContext };
