import {
  validateAffineFieldGridShape,
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