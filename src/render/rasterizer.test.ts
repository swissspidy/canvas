import { describe, expect, it } from "vitest";
import { toBase64 } from "./rasterizer.js";

describe("toBase64", () => {
  it("matches Buffer's encoding", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("round-trips a payload larger than the argument limit of fromCharCode", () => {
    // The chunked path exists because String.fromCharCode(...bytes) throws on
    // anything this size, which is every screenshot.
    const bytes = new Uint8Array(200_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    const encoded = toBase64(bytes);
    expect(Buffer.from(encoded, "base64").equals(Buffer.from(bytes))).toBe(true);
  });

  it("handles an empty array", () => {
    expect(toBase64(new Uint8Array(0))).toBe("");
  });
});
