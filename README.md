# Gridwarp

Gridwarp is a small TypeScript demo that renders SVG contour lines over a bicubically sampled scalar warp field. The current pipeline is polygon-based: a scalar amplitude surface and a directional surface are sampled on regular grids, composed into a warp field, and traced into SVG paths.

The page shell lives in [index.html](index.html), the browser entrypoint is [src/client/index.ts](src/client/index.ts), and the project runs through the Node HTTP server in [src/server/server.ts](src/server/server.ts).

## Prerequisites

- Node.js 22.13 or newer
- npm

## Setup

```bash
cd gridwarp
npm install
```

## Core Commands

```bash
npm start
npm run check
npm run typecheck
npm run lint
npm test
npm run coverage
```

- `npm start` starts the Node server at `http://127.0.0.1:4173/` by default.
- `npm run check` runs type-checking and linting together.
- `npm run typecheck` runs TypeScript without emitting files.
- `npm run lint` runs ESLint across the repo.
- `npm test` runs the regression suite through Node's test runner with `tsx` imports.
- `npm run coverage` runs the regression suite with experimental coverage enabled.

## Run the Demo

1. Start the local server with `npm start`.
2. Open `http://127.0.0.1:4173/` in your browser.

The UI currently exposes:

- `Time`: scales the final warp amplitude over time
- `Sample density`: changes the scalar and direction grid density in world units
- `Gain`: scales the scalar field before saturation
- `Plateau`: controls where the `satur(...)` clamp flattens the scalar field
- `Trace grid` and `Draw diagonals`: toggle contour and overlay rendering

## Project Structure

```text
index.html                        demo page shell
src/
  client/
    initial-geometry.ts          initial octagon, grid, and diagonal geometry serialization
    index.ts                      browser UI state, fetch, and viewport wiring
    transfer-curve.ts             browser-side transfer-curve plotting helpers
  render/
    contour-tracer.ts             contour tracing over scalar fields
    leaf-cell-collector.ts        adaptive viewport subdivision
    point-bucket-index.ts         seed/sample deduplication buckets
    polyline-overlay.ts           polygon helper geometry for overlays
    svg-contour-renderer.ts       SVG path serialization
    types.ts                      shared render types
    warp-scalar-fields.ts         scalar-field adapters around the warp
  lib/
    bicubic-grid-sampler.ts       shared Catmull-Rom regular-grid sampler
    direction-grid.ts             sampled unit-complex direction field
    polygon-geometry.ts           geometry primitives
    polygon-shape.ts              polygon distance and bounds queries
    regular-grid.ts               regular-grid storage and indexing
    saturation.ts                 smooth C1 saturation function
    scalar-grid.ts                scalar amplitude grid construction
    scalar-surface-warp-field.ts  warp composition from amplitude + direction
    warp-field.ts                 common warp interfaces
  server/
    render-warp-scene.ts          server-side SVG scene renderer
    server.ts                     HTTP routes and browser-module serving
  shared/
    warp-request.ts               shared request/response validation
test/
  server.test.ts                  HTTP route and API integration tests
  surface-pipeline.test.ts        scalar surface and warp regression tests
```

## Rendering Pipeline

The current render path is:

1. Build the initial outer octagon, inner octagon, grid families, diagonals, and world-space `viewBox` in the browser through [src/client/initial-geometry.ts](src/client/initial-geometry.ts).
2. Send that geometry SVG plus scalar parameters, including `samplesPerUnit`, to `/api/warp` from [src/client/index.ts](src/client/index.ts).
3. Parse and normalize the restricted SVG geometry plus its root `viewBox` on the server in [src/server/parse-geometry-svg.ts](src/server/parse-geometry-svg.ts).
4. Resolve world bounds plus density into rectangular grid dimensions in [src/lib/regular-grid.ts](src/lib/regular-grid.ts).
5. Build a polygon-bounded scalar amplitude grid and aligned direction grid over that same world rectangle in [src/lib/scalar-grid.ts](src/lib/scalar-grid.ts) and [src/lib/direction-grid.ts](src/lib/direction-grid.ts).
6. Bicubically sample both grids through [src/lib/bicubic-grid-sampler.ts](src/lib/bicubic-grid-sampler.ts).
7. Compose amplitude and direction into a warp using explicit world bounds in [src/lib/scalar-surface-warp-field.ts](src/lib/scalar-surface-warp-field.ts).
8. Trace arbitrary client-supplied polylines with [src/render/polyline-overlay.ts](src/render/polyline-overlay.ts), render the warped scene in [src/server/render-warp-scene.ts](src/server/render-warp-scene.ts), and replace the browser scene through [src/client/index.ts](src/client/index.ts).

## Deployment

This app now depends on the Node server because the browser module is served directly from TypeScript source and the warp computation runs on the server.

1. Install dependencies with `npm install`.
2. Start the app with `npm start`.
3. Reverse-proxy or expose the running Node server as needed.