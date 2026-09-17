# Driving the bench over WebMCP

The tool surfaces are published on `document.modelContext`, so any agent that
speaks WebMCP can lay out a document here without this repo's agent loop being
involved. The page keeps the document, renders it, and scores it.

```bash
npm run serve          # builds the bundle, then http://localhost:5173/webmcp.html
npm run e2e:webmcp     # the whole path, asserted, no API key needed
```

This works because the bench has no server in it. The document model, the
surfaces, the renderer and the scorer are pure; font loading and rasterizing
were the only things that touched Node, and both are registries with a Node
backend registered separately. Publishing the surfaces is therefore a
translation of what already exists — `src/webmcp/register.ts` is about a
hundred lines, and every call still goes through `executeToolCall`, so a run
driven from outside is validated and logged by exactly the code that handles a
run driven from inside.

---

## What is exposed, and to whom

The split is the load-bearing part.

**`document.modelContext`** — what the *agent* gets. The current surface's
tools, their descriptions, and their JSON Schemas. Nothing else.

**`window.__canvasBench`** — what a *harness* gets:

| Member | Purpose |
|---|---|
| `ready` | Resolves once fonts are loaded and tools are registered |
| `state()` | Task, surface, feedback mode, the document, the action log |
| `score()` | Constraint score, baseline, improvement, per-check detail |
| `setTask(id)` / `setSurface(id)` / `setFeedback(mode)` | Switch conditions |
| `reset()` | Reload the current task's starting document |
| `listTools()` / `callTool(name, input)` | Convenience wrappers |
| `png({ pixelWidth })` | The rendered document as a base64 PNG |
| `tasks`, `surfaces`, `feedbackModes` | What is available |
| `svg()` | The rendered document |

**The scorer is deliberately not a tool.** An agent that can call the checks
optimizes against the rubric instead of laying out a document, and the task
stops measuring anything. A test asserts no registered tool name matches
`score|check|grade|evaluate`.

---

## Driving it

From the console, or from anything with a page handle:

```js
const tools = await document.modelContext.getTools();
await document.modelContext.executeTool({ name: "align" }, { ids: ["r1", "r2"], edge: "left" });
```

`executeTool` returns a JSON string of an MCP-shaped result:

```json
{ "content": [{ "type": "text", "text": "Aligned r1, r2 on left at 109 (relative to selection)." }] }
```

A rejected call comes back with `isError: true` and the same wording the agent
loops use — the shared error formatter, not a second one:

```json
{ "content": [{ "type": "text", "text": "No element with id 'ghost'.\nHint: Existing ids: r1, r2, r3, r4, r5\nNothing was changed." }], "isError": true }
```

Switching surface disposes the old registration and installs the new one. The
document carries over untouched, so the surface toggle means the same thing
here as in the loops.

---

## With webmcp-evals

[webmcp-evals](https://github.com/GoogleChromeLabs/webmcp-tools/tree/main/webmcp-evals)
drives live WebMCP tools in a page via Puppeteer, with backends for
`@google/genai`, Ollama and the Vercel AI SDK — which is how you get Gemini,
GPT and Claude against these surfaces without writing three adapters.

**One thing to know before wiring it up.** Its test cases score *expected tool
calls* — `functionName` plus argument constraints like `$pattern`, `$contains`
and `$gt`. That is a different question from the one this repo asks. There is
no single expected call for "make a poster", and the entire premise here is
that different surfaces reach the *same outcome* through different calls, so
call-shape matching would score the surfaces on how closely they resemble each
other.

So use them for different halves:

- **webmcp-evals to drive**, and its constraint matching for the question it is
  actually good at: *given both vocabularies, does the agent reach for `align`
  or for five `move`s?* That is a call-shape question, and the `hybrid` surface
  exists precisely to ask it.
- **`window.__canvasBench.score()` to grade**, for whether the layout came out
  right.

`scripts/e2e-webmcp.mjs` is a worked example of the same shape: discover tools
from the page, convert the schemas to AI SDK tools, let a model call them,
execute each call back in the page, then read the page's own score.

---

## How images travel

**Screenshots do cross — the harness has to unpack them.** `executeTool` is
typed as returning a `string`, which reads like a bar on images. It is not: the
string is serialized JSON, so base64 image data passes through intact. A
screenshot-condition result looks like

```json
{ "content": [
  { "type": "text", "text": "Aligned r1, r2 on left at 109 (relative to selection)." },
  { "type": "image", "data": "iVBORw0KGgoAAAANSUhEUg…", "mimeType": "image/png" }
] }
```

which is the standard MCP image part. The end-to-end test asserts the base64 on
the far side decodes to a real PNG of the right dimensions, not merely that a
field is present.

What is genuinely on the harness is the *conversion*. If it parses the content
array and re-wraps the image part for its model API, the model sees a picture.
If it dumps the raw string in as text, the model gets tens of kilobytes of
base64 and cannot see anything — worse than sending nothing. One line, for the
AI SDK:

```js
const toModelPart = (part) =>
  part.type === "image"
    ? { type: "file", mediaType: part.mimeType, data: { type: "data", data: part.data } }
    : { type: "text", text: part.text };
```

`scripts/e2e-webmcp.mjs` does exactly this and asserts the model received a
file part rather than base64 text.

**All six feedback conditions work in the browser.** Screenshots are produced by
`src/render/browser-raster.ts` — the SVG is drawn into an `<img>`, painted onto
a canvas and read back as PNG bytes — so `screenshot`, `both` and `both_plain`
are as available here as under Node's resvg.

One thing that had to be right: an SVG loaded as an image is an isolated
document and cannot reach the host page's stylesheets, so a `font-family`
reference alone would paint in a fallback. The face is inlined into the SVG as a
data URI instead. Layout would have survived either way — every line is pinned
to its computed width with `textLength` — but the screenshot the agent sees
should be the document the scorer measured, in the same typeface. The
end-to-end test renders with and without the embedded face and asserts the two
differ, which is the only way to know embedding is doing anything.

---

## The one real limitation

**It runs on a polyfill.** No browser ships WebMCP yet, so
`src/webmcp/polyfill.ts` installs a `document.modelContext` that implements the
shape declared in `webmcp-types` and nothing more. It stands aside when a real
implementation exists, and the page says which is in play — "polyfill" or
"native WebMCP" — because results obtained through a polyfill are results
obtained through a polyfill.

That is why `docs/PREREGISTRATION.md` keeps anything measured over WebMCP in the
exploratory column. Not because the protocol cannot carry what the study needs
— it can, including screenshots — but because the implementation under it here
is ours.

---

## What the end-to-end test asserts

`npm run e2e:webmcp` runs in about three seconds against the SDK's mock model,
so it needs no API key and can sit in CI. Pass `--model provider:model-id` to
drive it with a real one. It checks 28 things across seven stages:

1. The page hosts the bench and publishes tools; no page errors.
2. A harness discovers them straight off `document.modelContext` — every tool
   carries a JSON Schema, the relational surface exposes `place` and no raw
   coordinate, and no scorer is reachable.
3. The discovered schemas convert to AI SDK tools.
4. The model's calls execute *in the page*, including a deliberately malformed
   one, to prove the error path survives the round trip.
5. The screenshot crosses intact: the base64 decodes to a PNG of the right
   dimensions, it reaches the model as a file part rather than as text, and the
   embedded font is demonstrably applied.
6. The page's own state and scorer reflect the work: the rows share one left
   edge, the rejected call is in the log, the score beats the baseline.
7. Switching surface re-registers the tools and keeps the document.
