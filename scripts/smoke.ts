import { writeFileSync } from "node:fs";
import { rasterize } from "../src/render/raster.js";
import { renderSvg } from "../src/render/svg.js";
import { describeDoc } from "../src/render/describe.js";
import type { Doc } from "../src/doc/types.js";

const doc: Doc = {
  width: 1080,
  height: 1350,
  background: "#fdf6ec",
  elements: [
    { id: "el_1", type: "image", x: 0, y: 0, width: 1080, height: 720, rotation: 0, z: 0,
      src: "photo/mountains", style: { objectFit: "cover" } },
    { id: "el_2", type: "rect", x: 80, y: 600, width: 920, height: 260, rotation: 0, z: 1,
      style: { fill: "#ffffffee", radius: 24 } },
    { id: "el_3", type: "text", x: 110, y: 630, width: 860, height: 120, rotation: 0, z: 2,
      text: "Ridgeline Festival", style: { fontSize: 88, fontWeight: "bold", color: "#1a1a2e", align: "center" } },
    { id: "el_4", type: "text", x: 110, y: 760, width: 860, height: 70, rotation: 0, z: 3,
      text: "Three days of music above the clouds — September 12 to 14", style: { fontSize: 30, color: "#4a4a63", align: "center" } },
    { id: "el_5", type: "text", x: 700, y: 1180, width: 300, height: 60, rotation: -6, z: 4,
      text: "Tickets on sale now and they will not last long at all", style: { fontSize: 34, color: "#f5f5f5", fill: "#c0392b", padding: 10, align: "center" } },
  ],
};

writeFileSync("/tmp/claude-0/-home-user-canvas/63709191-fd6f-5bbf-9b10-cba941e378cc/scratchpad/smoke.svg", renderSvg(doc));
const png = rasterize(doc, { pixelWidth: 540 });
writeFileSync("/tmp/claude-0/-home-user-canvas/63709191-fd6f-5bbf-9b10-cba941e378cc/scratchpad/smoke.png", png);
console.log("png bytes:", png.length);
console.log("---- describe(analysis) ----");
console.log(describeDoc(doc));
