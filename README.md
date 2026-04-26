# Gridwarp

A small TypeScript demo that turns a time-dependent complex warp into a static SVG image: smooth contour lines of the warped grid, traced and rendered as cubic Bézier paths.

The page renders into [index.html](index.html); all code lives under [src/](src).

---

## 1. Prerequisites

- **Node.js** ≥ 20 (for the built-in `node:test` runner used via `tsx`).
- **npm** (ships with Node).
- A modern browser that can open a local `file://` URL (Chrome, Firefox, Safari).

No bundler, dev server, or framework is required.

---

## 2. Setup

```bash
git clone <this-repo>
cd gridwarp
npm install
```

That installs the build (`typescript`), runner (`tsx`), and lint (`eslint`, `typescript-eslint`) toolchain only — there are no runtime dependencies.

---

## 3. Project Structure

```
src/
  demo.ts                          orchestration entry point; loaded by index.html
  lib/
    complex.ts                     complex numbers and affine-pair primitives
    deformation-field.ts           pure spiral warp definition: w(z) = a(z, t)·z + b(z, t)
    affine-field-grid.ts           samples the warp onto a 2D lattice of (a, b) pairs
    bilinear-affine-field-handle.ts bilinear interpolation between lattice knots
    warp-field.ts                  screen-space warp: viewport coords + Jacobian
  demo/
    types.ts                       shared types for the tracing pipeline
    centered-radial-warp.ts        builds the screen-space warp used by the demo
    field-context.ts               adapts WarpField to the level-set form needed by Newton
    leaf-cell-collector.ts         adaptive viewport subdivision into leaf cells
    point-bucket-index.ts          coarse spatial index for seed/sample deduplication
    contour-tracer.ts              marching squares + Newton projection + tangent tracing
    svg-contour-renderer.ts        emits cubic Bézier <path> elements
test/
  affine-grid.test.ts              regression tests for math + grid sampling
  support/                         test-only helpers
index.html                         demo page (loads dist/src/demo.js)
```

---

## 4. Build

```bash
npm run build
```

Compiles the TypeScript sources with `tsc -p tsconfig.json` into `dist/`. The page (`index.html`) loads `dist/src/demo.js` as a native ES module.

For a typecheck-only run without emitting files:

```bash
npm run typecheck
```

---

## 5. Run the Demo

After building:

1. Open [index.html](index.html) directly in your browser (`file://…/gridwarp/index.html`).
2. Use the slider or numeric input to scrub the warp through time.
3. The SVG re-renders on every time change and on viewport resize.

No HTTP server is needed — the page references `dist/` with a relative path.

---

## 6. Lint

```bash
npm run lint
```

Runs ESLint with the typed-strict `typescript-eslint` ruleset. Lint must be clean before committing.

---

## 7. Test

```bash
npm test
```

Runs the regression suite via `tsx --test test/**/*.test.ts`. The suite covers complex arithmetic, lattice generation, bilinear interpolation, and validation errors. For coverage:

```bash
npm run test:coverage
```

---

## 8. Deployment

The demo is fully static. To deploy:

1. Run `npm run build` once to populate `dist/`.
2. Upload these to any static host (GitHub Pages, S3, Netlify, …):
   - `index.html`
   - `dist/` (the entire compiled tree)
3. Ensure `index.html` and `dist/` keep their relative layout — `index.html` references `dist/src/demo.js`.

No server-side configuration is required.

---

## How the rendering works

The pipeline is three independent stages, each owned by a separate module:

### Stage A — Define the spiral warp

For each plane point `z` and time `t`, [src/lib/deformation-field.ts](src/lib/deformation-field.ts) returns the local complex affine pair `(a, b)` such that the warp evaluates as

```
w(z) = a · z + b
```

Complex arithmetic primitives live in [src/lib/complex.ts](src/lib/complex.ts).

### Stage B — Sample the warp on a 2D lattice

[src/lib/affine-field-grid.ts](src/lib/affine-field-grid.ts) evaluates the warp on a rectangular `columns × rows` lattice described by an `AffineGridSpec`. Each cell stores one affine pair (`grid[row][column].a`, `grid[row][column].b`).

Between knots, [src/lib/bilinear-affine-field-handle.ts](src/lib/bilinear-affine-field-handle.ts) interpolates bilinearly so the discrete table can be queried as a continuous function. [src/lib/warp-field.ts](src/lib/warp-field.ts) wraps that handle as a screen-space `WarpField` with a finite-difference Jacobian.

### Stage C — Trace contours and emit SVG

The demo orchestrator ([src/demo.ts](src/demo.ts)) drives the contour pipeline:

1. [`LeafCellCollector`](src/demo/leaf-cell-collector.ts) adaptively subdivides the viewport, producing a set of leaf cells whose curvature error is below a threshold.
2. [`ContourTracer`](src/demo/contour-tracer.ts) extracts marching-squares seed segments from each leaf cell, projects each seed onto a contour with Newton iteration, and follows the tangent field with a midpoint predictor/corrector until the curve closes or leaves the viewport.
3. [`SvgContourRenderer`](src/demo/svg-contour-renderer.ts) converts each traced component into a smooth cubic Bézier `<path>` element and appends it to the live SVG.

Each stage is independently testable; the math layers under `src/lib/` know nothing about the DOM.