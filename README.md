# Gridwarp

This project turns a time-dependent complex warp into traced SVG contour lines.

## Step 1: Define the spiral warp

The mathematical warp is defined in terms of complex affine pairs `(a, b)` with

`w(z) = a(z, t) * z + b(z, t)`.

In the current implementation, the active deformation is a centered radial spiral-like warp. The local coefficients are computed in [src/lib/deformation-field.ts](src/lib/deformation-field.ts), while the complex arithmetic primitives live in [src/lib/complex.ts](src/lib/complex.ts).

The role of this step is to answer: for one point in the plane and one time value, what local affine map should be applied?

## Step 2: Generate the field in a 2D array

Once the local warp is defined, the project samples it on a rectangular lattice. The sampling specification is described by `AffineGridSpec`, and the resulting 2D array is built by `createAffineFieldGrid` in [src/lib/affine-field-grid.ts](src/lib/affine-field-grid.ts).

Each grid cell stores one affine pair:

- `grid[row][column].a`
- `grid[row][column].b`

At runtime, [src/lib/bilinear-affine-field-handle.ts](src/lib/bilinear-affine-field-handle.ts) bilinearly interpolates neighbouring pairs so the discrete array can be queried continuously between lattice points.

## Step 3: Trace SVG contours

The sampled affine field is then wrapped as a screen-space warp in [src/lib/warp-field.ts](src/lib/warp-field.ts). From there, [src/demo.ts](src/demo.ts) and the files under [src/demo](src/demo) perform the contour-tracing pipeline:

- adaptively subdivide the viewport into leaf cells
- extract marching-squares seed segments
- project and trace contour curves in screen space
- convert traced components into SVG path data

The final SVG path generation is handled by [src/demo/svg-contour-renderer.ts](src/demo/svg-contour-renderer.ts).