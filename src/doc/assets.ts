/**
 * The image asset library.
 *
 * Agents cannot upload images, so `image` elements reference a fixed library
 * by key. Assets are procedural SVG rather than binaries: the renderer stays
 * a pure function, the repo stays small, and every run renders byte-identical
 * pixels on every machine.
 *
 * Intrinsic aspect ratios are real and varied, because "this photo does not
 * fit its box" is one of the situations the tool surfaces are being compared
 * on.
 */

export interface Asset {
  key: string;
  label: string;
  /** Intrinsic size; only the ratio matters. */
  width: number;
  height: number;
  /** Two-stop gradient, from/to. */
  from: string;
  to: string;
  /** Rough perceived lightness 0..1, used by the contrast check. */
  lightness: number;
  /** Simple shape motif painted over the gradient. */
  motif: "peaks" | "portrait" | "grain" | "arc" | "grid";
}

export const ASSETS: Record<string, Asset> = {
  "photo/mountains": {
    key: "photo/mountains",
    label: "a mountain range at dusk",
    width: 1600,
    height: 1067,
    from: "#2b3a67",
    to: "#8a6fa8",
    lightness: 0.34,
    motif: "peaks",
  },
  "photo/portrait": {
    key: "photo/portrait",
    label: "a portrait of a person",
    width: 800,
    height: 1200,
    from: "#c98b6b",
    to: "#5b3a2e",
    lightness: 0.45,
    motif: "portrait",
  },
  "photo/coffee": {
    key: "photo/coffee",
    label: "a cup of coffee on a table",
    width: 1200,
    height: 1200,
    from: "#d9c7a8",
    to: "#6b4f34",
    lightness: 0.56,
    motif: "arc",
  },
  "photo/city": {
    key: "photo/city",
    label: "a city skyline at night",
    width: 1920,
    height: 810,
    from: "#0e1726",
    to: "#28405c",
    lightness: 0.16,
    motif: "grid",
  },
  "texture/paper": {
    key: "texture/paper",
    label: "a sheet of textured paper",
    width: 1000,
    height: 1000,
    from: "#f3ede2",
    to: "#ded3c0",
    lightness: 0.88,
    motif: "grain",
  },
  "texture/gradient": {
    key: "texture/gradient",
    label: "a soft color gradient",
    width: 1000,
    height: 1000,
    from: "#ff7a59",
    to: "#ffd166",
    lightness: 0.7,
    motif: "grain",
  },
};

export const ASSET_KEYS = Object.keys(ASSETS);

export function getAsset(key: string | undefined): Asset | undefined {
  if (!key) return undefined;
  return ASSETS[key];
}

export function assetAspect(key: string | undefined): number | undefined {
  const a = getAsset(key);
  return a ? a.width / a.height : undefined;
}

/** One-line catalogue for prompts, so the agent knows what it can reference. */
export function assetCatalogue(): string {
  return ASSET_KEYS.map((k) => {
    const a = ASSETS[k]!;
    return `${k} (${a.label}, ${a.width}x${a.height})`;
  }).join("\n");
}
