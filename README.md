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
- `Sample grid`: changes the scalar and direction grid resolution
- `Gain`: scales the scalar field before saturation
- `Plateau`: controls where the `satur(...)` clamp flattens the scalar field
- `Trace grid` and `Draw diagonals`: toggle contour and overlay rendering

## Project Structure

```text
index.ts                          re-exports the app server entrypoint
index.html                        demo page shell
src/
  client/
    index.ts                      browser UI state, fetch, and viewport wiring
  demo/
    contour-tracer.ts             contour tracing over scalar fields
    leaf-cell-collector.ts        adaptive viewport subdivision
    octagon-overlay.ts            warped octagon overlay rendering
    point-bucket-index.ts         seed/sample deduplication buckets
    polyline-overlay.ts           polygon helper geometry for overlays
    svg-contour-renderer.ts       SVG path serialization
    types.ts                      shared demo types
    visible-warp-bounds.ts        visible-domain sampling helpers
    warp-scalar-fields.ts         scalar-field adapters around the warp
  lib/
    bicubic-grid-sampler.ts       shared Catmull-Rom regular-grid sampler
    direction-grid.ts             sampled unit-complex direction field
    octagon-constants.ts          shared octagon radii
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

1. Build a polygon-bounded scalar amplitude grid in [src/lib/scalar-grid.ts](src/lib/scalar-grid.ts).
2. Build a direction grid of unit-complex components in [src/lib/direction-grid.ts](src/lib/direction-grid.ts).
3. Bicubically sample both grids through [src/lib/bicubic-grid-sampler.ts](src/lib/bicubic-grid-sampler.ts).
4. Compose amplitude and direction into a warp in [src/lib/scalar-surface-warp-field.ts](src/lib/scalar-surface-warp-field.ts).
5. Trace contours with [src/demo/contour-tracer.ts](src/demo/contour-tracer.ts) and render them to SVG with [src/demo/svg-contour-renderer.ts](src/demo/svg-contour-renderer.ts).
6. Return the final SVG through [src/server/render-warp-scene.ts](src/server/render-warp-scene.ts) and replace the browser scene through [src/client/index.ts](src/client/index.ts).

## Deployment

This app now depends on the Node server because the browser module is served directly from TypeScript source and the warp computation runs on the server.

1. Install dependencies with `npm install`.
2. Start the app with `npm start`.
3. Reverse-proxy or expose the running Node server as needed.