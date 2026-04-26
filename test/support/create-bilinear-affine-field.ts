/**
 * Test-only helper for constructing validated bilinear affine field handles.
 */
import {
  validateAffineGridSpec,
  type AffineGridSpec,
} from "../../src/lib/affine-field-grid.js";
import { BilinearAffineFieldHandle } from "../../src/lib/bilinear-affine-field-handle.js";
import type { ComplexAffinePair } from "../../src/lib/complex.js";

export function createBilinearAffineField(
  spec: AffineGridSpec,
  grid: readonly (readonly ComplexAffinePair[])[],
): BilinearAffineFieldHandle {
  validateAffineGridSpec(spec);
  validateAffineFieldGridShape(spec, grid);
  return new BilinearAffineFieldHandle(spec, grid);
}

function validateAffineFieldGridShape(
  spec: AffineGridSpec,
  grid: readonly (readonly ComplexAffinePair[])[],
): void {
  if (grid.length !== spec.rows) {
    throw new Error(
      "Affine field grid row count does not match the specification.",
    );
  }

  for (const row of grid) {
    if (row.length !== spec.columns) {
      throw new Error(
        "Affine field grid column count does not match the specification.",
      );
    }
  }
}
