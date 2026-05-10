# Gridwarp

Gridwarp is a small TypeScript demo that renders SVG contour lines over a bicubically sampled scalar warp field. The current pipeline is polygon-based: a scalar amplitude surface and a directional surface are sampled on regular grids, composed into a warp field, and traced into SVG paths.

The page shell lives in [index.html](index.html), the browser entrypoint is [src/demo.ts](src/demo.ts), and the project serves the built files over a tiny Node HTTP server started from [index.ts](index.ts).

## Prerequisites

- Node.js 20 or newer
- npm

## Setup

```bash
git clone <this-repo>
cd gridwarp
npm install
```

## Core Commands

```bash
npm run build
npm run serve
npm run typecheck
npm run lint
npm test
```

- `npm run build` compiles the TypeScript sources into `dist/`.
- `npm run serve` starts the static server at `http://127.0.0.1:4173/` by default.
- `npm run typecheck` runs TypeScript without emitting files.
- `npm run lint` runs ESLint across the repo.
- `npm test` runs the regression suite via `tsx --test`.

## Run the Demo

1. Build the app with `npm run build`.
2. Start the local server with `npm run serve`.
3. Open `http://127.0.0.1:4173/` in your browser.

The UI currently exposes:

- `Time`: scales the final warp amplitude over time
- `Gain`: scales the scalar field before saturation
- `Plateau`: controls where the `satur(...)` clamp flattens the scalar field
- `Trace grid` and `Draw diagonals`: toggle contour and overlay rendering

## Project Structure

```text
index.ts                          static file server launched by tsx
index.html                        demo page shell
src/
  demo.ts                         demo orchestration and UI wiring
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
test/
  surface-pipeline.test.ts        scalar surface and warp regression tests
  affine-grid.test.ts             generic bicubic sampler regression tests
```

## Rendering Pipeline

The current render path is:

1. Build a polygon-bounded scalar amplitude grid in [src/lib/scalar-grid.ts](src/lib/scalar-grid.ts).
2. Build a direction grid of unit-complex components in [src/lib/direction-grid.ts](src/lib/direction-grid.ts).
3. Bicubically sample both grids through [src/lib/bicubic-grid-sampler.ts](src/lib/bicubic-grid-sampler.ts).
4. Compose amplitude and direction into a warp in [src/lib/scalar-surface-warp-field.ts](src/lib/scalar-surface-warp-field.ts).
5. Trace contours with [src/demo/contour-tracer.ts](src/demo/contour-tracer.ts) and render them to SVG with [src/demo/svg-contour-renderer.ts](src/demo/svg-contour-renderer.ts).

## Deployment

The built app remains static. For static hosting:

1. Run `npm run build`.
2. Upload [index.html](index.html), [favicon.svg](favicon.svg), and the full [dist](dist) directory.
3. Serve them over HTTP so the native ES modules load correctly.