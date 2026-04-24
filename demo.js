// Adaptive seed grid.
const DEFAULT_TIME = 16.0;
const MAX_CONTOUR_CELL_SIZE = 8;
const MIN_CONTOUR_CELL_SIZE = 3;
const CURVATURE_ERROR_THRESHOLD = 0.02;
const MAX_ADAPTIVE_DEPTH = 3;
const GRID_OFFSET = 0.5;

// Contour tracing.
const STROKE_WIDTH = 2.2;
const MIN_GRADIENT_NORM = 1e-4;
const NEWTON_TOLERANCE = 1e-3;
const MAX_PROJECTION_ITERATIONS = 10;
const MAX_NEWTON_DISPLACEMENT = 2;
const INITIAL_TRACE_STEP = 4;
const MAX_TRACE_STEP = 8;
const TRACE_MIN_STEP = 0.25;
const TRACE_TARGET_CORRECTION = 0.4;
const MAX_TRACE_TURN = Math.PI / 6;
const MAX_TRACE_STEPS = 4000;
const LOOP_CLOSURE_DISTANCE = 3;
const MIN_LOOP_ARC_LENGTH = 40;
const SEED_DEDUP_DISTANCE = 4;
const VISITED_BUCKET_SIZE = 18;
const VISITED_SEED_DISTANCE = 10;

// SVG output and UI formatting.
const PATH_DECIMALS = 2;
const SVG_NS = "http://www.w3.org/2000/svg";

const scene = document.getElementById("scene");
const caption = document.getElementById("caption");
const timeSlider = document.getElementById("time-slider");
const timeInput = document.getElementById("time-input");
const timeValue = document.getElementById("time-value");
const minTime = Number(timeSlider.min);
const maxTime = Number(timeSlider.max);

let currentTime = DEFAULT_TIME;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mix(a, b, amount) {
  return a * (1 - amount) + b * amount;
}

function smootherstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function smoothMin(a, b, softness) {
  const h = smootherstep(-softness, softness, b - a);
  return mix(b, a, h);
}

function distance(pointA, pointB) {
  return Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y);
}

function dot(vectorA, vectorB) {
  return vectorA.x * vectorB.x + vectorA.y * vectorB.y;
}

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y);
  if (length < 1e-9) {
    return null;
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
  };
}

function reverseSamples(samples) {
  return samples.slice().reverse().map((sample) => ({
    x: sample.x,
    y: sample.y,
    tangent: {
      x: -sample.tangent.x,
      y: -sample.tangent.y,
    },
  }));
}

// ---------------------------------------------------------------------------
// Warp field abstraction.
//
// A WarpField is a pluggable, screen-space description of the grid warp:
//
//   valueAt(screenX, screenY)    -> { warpedX, warpedY }
//   jacobianAt(screenX, screenY) -> { xx, xy, yx, yy }   (row-major 2x2:
//                                     d warpedX / d screenX, d warpedX / d screenY,
//                                     d warpedY / d screenX, d warpedY / d screenY)
//   bounds()                     -> { width, height }
//
// The marching-squares and contour-tracing code only ever calls these three
// methods, so new warps are added by providing a new factory.
// `withFiniteDifferenceJacobian` wraps any `valueAt`-only field with a default
// numerical jacobian, useful while a new warp's analytic derivative is being
// derived (or for debugging the analytic one).
// ---------------------------------------------------------------------------

function withFiniteDifferenceJacobian(warpField, epsilon = 0.75) {
  const { width, height } = warpField.bounds();
  return {
    valueAt: (x, y) => warpField.valueAt(x, y),
    jacobianAt(x, y) {
      const x0 = clamp(x - epsilon, 0, width);
      const x1 = clamp(x + epsilon, 0, width);
      const y0 = clamp(y - epsilon, 0, height);
      const y1 = clamp(y + epsilon, 0, height);
      const sx1 = warpField.valueAt(x1, y);
      const sx0 = warpField.valueAt(x0, y);
      const sy1 = warpField.valueAt(x, y1);
      const sy0 = warpField.valueAt(x, y0);
      const dx = Math.max(1e-6, x1 - x0);
      const dy = Math.max(1e-6, y1 - y0);
      return {
        xx: (sx1.warpedX - sx0.warpedX) / dx,
        xy: (sy1.warpedX - sy0.warpedX) / dy,
        yx: (sx1.warpedY - sx0.warpedY) / dx,
        yy: (sy1.warpedY - sy0.warpedY) / dy,
      };
    },
    bounds: () => ({ width, height }),
  };
}

// Radial rotation + smoothMin inward-pull, matching warpedgrid.shader.
// `valueAt` reproduces the shader's warpedUv; `jacobianAt` is the analytic
// 2x2 derivative, avoiding finite-difference artefacts near r~=0 and near
// the smoothMin transition. See derivation notes below the factory body.
function createCenteredRadialWarp(width, height, time) {
  const planeScale = height / 10;

  function toPlane(x, y) {
    return {
      x: (x - width * 0.5) / planeScale,
      y: (height * 0.5 - y) / planeScale,
    };
  }

  // All r-derivatives of the shader's radial coefficients carry an explicit
  // factor of r coming from w'(r) = -0.32 * r * w(r).  We return sigma_r / r
  // and theta_r / r so the caller can build the Jacobian without dividing
  // by r -- the origin is then just the sigma * R limit, no special case.
  function radialCoefficients(radius) {
    const weight = Math.exp(-0.16 * radius * radius);
    const angle = time * (0.0022 + 0.01 * weight) * weight;
    const pullBase = time * (0.015 + 0.075 * weight);
    const u = 1 + pullBase * weight;
    const softness = 0.2;
    const ttRaw = (u - 3 + softness) / (2 * softness);
    const tt = clamp(ttRaw, 0, 1);
    const h = tt * tt * tt * (tt * (tt * 6 - 15) + 10);
    const sigma = u + h * (3 - u);

    const wOverR = -0.32 * weight;
    const uROverR = wOverR * time * (0.015 + 0.15 * weight);
    const thetaROverR = wOverR * time * (0.0022 + 0.02 * weight);

    // sigma = u + h(r) * (3 - u) so
    //   sigma' = u' * (1 - h) + (3 - u) * h'
    // with h' = smootherstep'(tt) * u' / (2k).
    let bracket = 1 - h;
    if (ttRaw > 0 && ttRaw < 1) {
      const dhdtt = 30 * tt * tt * (1 - tt) * (1 - tt);
      bracket += (3 - u) * dhdtt / (2 * softness);
    }
    const sigmaROverR = uROverR * bracket;

    return { angle, sigma, sigmaROverR, thetaROverR };
  }

  function valueAt(x, y) {
    const p = toPlane(x, y);
    const r = Math.hypot(p.x, p.y);
    const { angle, sigma } = radialCoefficients(r);
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    return {
      warpedX: sigma * (cosA * p.x - sinA * p.y),
      warpedY: sigma * (sinA * p.x + cosA * p.y),
    };
  }

  // J_plane = sigma * R + [sigmaROverR * rho + sigma * thetaROverR * (R' * p)] * p^T
  //   where rho = R(theta) * p and R' = dR/dtheta so R' * p = R * perp(p).
  // J_screen = J_plane * diag(1/planeScale, -1/planeScale)  (chain through toPlane).
  function jacobianAt(x, y) {
    const p = toPlane(x, y);
    const r = Math.hypot(p.x, p.y);
    const { angle, sigma, sigmaROverR, thetaROverR } = radialCoefficients(r);
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    const rhoX = cosA * p.x - sinA * p.y;
    const rhoY = sinA * p.x + cosA * p.y;
    // R' * p = R * (-p.y, p.x)
    const rPerpPX = -cosA * p.y - sinA * p.x;
    const rPerpPY = -sinA * p.y + cosA * p.x;

    const kx = sigmaROverR * rhoX + sigma * thetaROverR * rPerpPX;
    const ky = sigmaROverR * rhoY + sigma * thetaROverR * rPerpPY;

    const jPlaneXX = sigma * cosA + kx * p.x;
    const jPlaneXY = -sigma * sinA + kx * p.y;
    const jPlaneYX = sigma * sinA + ky * p.x;
    const jPlaneYY = sigma * cosA + ky * p.y;

    const invS = 1 / planeScale;
    return {
      xx: jPlaneXX * invS,
      xy: -jPlaneXY * invS,
      yx: jPlaneYX * invS,
      yy: -jPlaneYY * invS,
    };
  }

  return {
    valueAt,
    jacobianAt,
    bounds: () => ({ width, height }),
  };
}

// Placeholder for a future warp backed by a 2-D array S of complex (a, b)
// pairs that define a local affine map z' = a * z + b. a and b are
// bilinearly interpolated between grid samples, so inside each S-cell the
// Jacobian is closed-form linear in (x, y).
//
// The shape of this factory is fixed (returns a WarpField), so it can be
// dropped into the renderer without touching marching squares or the tracer
// -- only this file changes once an S dataset exists.
//
// NOTE: intentionally not implemented. Left as a deliberate TODO so the
// interface stays visible at the top of the file next to
// createCenteredRadialWarp.
function createBilinearAffineField(/* config, sData */) {
  throw new Error("createBilinearAffineField is not implemented yet.");
}

// ---------------------------------------------------------------------------
// Viewport bounds / grid level sets
// ---------------------------------------------------------------------------

function visibleBounds(width, height) {
  return {
    xMax: 5 * width / height,
    yMax: 5,
  };
}

function maxWarpedRadius(width, height, time) {
  const { xMax, yMax } = visibleBounds(width, height);
  const probe = createCenteredRadialWarp(width, height, time);
  const planeScale = height / 10;
  let maximum = 0;
  for (let step = 0; step <= 256; step += 1) {
    const t = step / 256;
    // Sample along the plane-space corner ray through the origin.  R is a
    // rotation, so |warped| equals sigma(r) * r for any ray direction.
    const screenX = width * 0.5 + planeScale * t * xMax;
    const screenY = height * 0.5 - planeScale * t * yMax;
    const v = probe.valueAt(screenX, screenY);
    maximum = Math.max(maximum, Math.hypot(v.warpedX, v.warpedY));
  }
  return maximum + 1;
}

function lineOffsets(limit) {
  const values = [];
  const start = Math.floor(-limit);
  const end = Math.ceil(limit);
  for (let index = start; index <= end; index += 1) {
    values.push(index + GRID_OFFSET);
  }
  return values;
}

function coordinateAxis(length, cellSize) {
  const steps = Math.max(2, Math.ceil(length / cellSize));
  const coordinates = [];
  for (let index = 0; index <= steps; index += 1) {
    coordinates.push(length * index / steps);
  }
  return coordinates;
}

// ---------------------------------------------------------------------------
// Quadtree of leaf cells
//
// A cell is { tl, tr, br, bl } with each corner carrying screenX/screenY
// and the evaluated warpedX/warpedY.  We build a flat array of leaf cells by
// recursively subdividing a base grid where the field departs from bilinear.
// Refinement is *per cell* -- no global row/column insertion -- so a single
// curved region no longer forces resampling of its entire row and column.
// ---------------------------------------------------------------------------

function sampleNode(warp, x, y) {
  const v = warp.valueAt(x, y);
  return { screenX: x, screenY: y, warpedX: v.warpedX, warpedY: v.warpedY };
}

function axisCurvatureError(topLeft, topRight, bottomRight, bottomLeft, topMid, rightMid, bottomMid, leftMid, center, axis) {
  return Math.max(
    Math.abs(center[axis] - 0.25 * (topLeft[axis] + topRight[axis] + bottomRight[axis] + bottomLeft[axis])),
    Math.abs(topMid[axis] - 0.5 * (topLeft[axis] + topRight[axis])),
    Math.abs(rightMid[axis] - 0.5 * (topRight[axis] + bottomRight[axis])),
    Math.abs(bottomMid[axis] - 0.5 * (bottomLeft[axis] + bottomRight[axis])),
    Math.abs(leftMid[axis] - 0.5 * (topLeft[axis] + bottomLeft[axis])),
  );
}

function collectLeafCells(width, height, warp) {
  const xCoords = coordinateAxis(width, MAX_CONTOUR_CELL_SIZE);
  const yCoords = coordinateAxis(height, MAX_CONTOUR_CELL_SIZE);
  const rows = yCoords.length - 1;
  const cols = xCoords.length - 1;

  const baseNodes = [];
  for (let row = 0; row <= rows; row += 1) {
    const nodeRow = [];
    for (let col = 0; col <= cols; col += 1) {
      nodeRow.push(sampleNode(warp, xCoords[col], yCoords[row]));
    }
    baseNodes.push(nodeRow);
  }

  const leafCells = [];

  function refineCell(tl, tr, br, bl, depth) {
    const cellWidth = tr.screenX - tl.screenX;
    const cellHeight = bl.screenY - tl.screenY;

    if (depth >= MAX_ADAPTIVE_DEPTH || Math.max(cellWidth, cellHeight) * 0.5 < MIN_CONTOUR_CELL_SIZE) {
      leafCells.push({ tl, tr, br, bl });
      return;
    }

    const midX = 0.5 * (tl.screenX + tr.screenX);
    const midY = 0.5 * (tl.screenY + bl.screenY);
    const topMid = sampleNode(warp, midX, tl.screenY);
    const rightMid = sampleNode(warp, tr.screenX, midY);
    const bottomMid = sampleNode(warp, midX, bl.screenY);
    const leftMid = sampleNode(warp, tl.screenX, midY);
    const center = sampleNode(warp, midX, midY);

    const curvature = Math.max(
      axisCurvatureError(tl, tr, br, bl, topMid, rightMid, bottomMid, leftMid, center, "warpedX"),
      axisCurvatureError(tl, tr, br, bl, topMid, rightMid, bottomMid, leftMid, center, "warpedY"),
    );

    if (curvature <= CURVATURE_ERROR_THRESHOLD) {
      leafCells.push({ tl, tr, br, bl });
      return;
    }

    refineCell(tl, topMid, center, leftMid, depth + 1);
    refineCell(topMid, tr, rightMid, center, depth + 1);
    refineCell(center, rightMid, br, bottomMid, depth + 1);
    refineCell(leftMid, center, bottomMid, bl, depth + 1);
  }

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      refineCell(
        baseNodes[row][col],
        baseNodes[row][col + 1],
        baseNodes[row + 1][col + 1],
        baseNodes[row + 1][col],
        1,
      );
    }
  }

  return leafCells;
}

// ---------------------------------------------------------------------------
// Marching squares (16-case, saddle-disambiguated, per-cell [min,max] cull)
//
// Corner bits: TL=1, TR=2, BR=4, BL=8.
// Edge names: top (TL-TR), right (TR-BR), bottom (BR-BL), left (BL-TL).
// Saddle cases 5 and 10 sample the cell centre to decide which pairing of
// edge crossings is topologically correct.
// ---------------------------------------------------------------------------

function interpolateZero(nodeA, valueA, nodeB, valueB) {
  const amount = Math.abs(valueA - valueB) < 1e-6 ? 0.5 : clamp(valueA / (valueA - valueB), 0, 1);
  return {
    x: mix(nodeA.screenX, nodeB.screenX, amount),
    y: mix(nodeA.screenY, nodeB.screenY, amount),
  };
}

function pushCellSegments(segments, cell, axis, offset, warp) {
  const { tl, tr, br, bl } = cell;
  const vTL = tl[axis] - offset;
  const vTR = tr[axis] - offset;
  const vBR = br[axis] - offset;
  const vBL = bl[axis] - offset;

  const maxV = Math.max(vTL, vTR, vBR, vBL);
  const minV = Math.min(vTL, vTR, vBR, vBL);
  if (minV > 0 || maxV < 0) return;

  const mask = (vTL > 0 ? 1 : 0) | (vTR > 0 ? 2 : 0) | (vBR > 0 ? 4 : 0) | (vBL > 0 ? 8 : 0);
  if (mask === 0 || mask === 15) return;

  const top = () => interpolateZero(tl, vTL, tr, vTR);
  const right = () => interpolateZero(tr, vTR, br, vBR);
  const bottom = () => interpolateZero(br, vBR, bl, vBL);
  const left = () => interpolateZero(bl, vBL, tl, vTL);

  switch (mask) {
    case 1: case 14: segments.push([top(), left()]); return;
    case 2: case 13: segments.push([top(), right()]); return;
    case 3: case 12: segments.push([left(), right()]); return;
    case 4: case 11: segments.push([right(), bottom()]); return;
    case 6: case 9:  segments.push([top(), bottom()]); return;
    case 7: case 8:  segments.push([left(), bottom()]); return;
    case 5: {
      // TL+, BR+, TR-, BL-.  Centre positive => positives connect through
      // the middle, so contour arcs wrap the two negative corners.
      const cx = 0.25 * (tl.screenX + tr.screenX + br.screenX + bl.screenX);
      const cy = 0.25 * (tl.screenY + tr.screenY + br.screenY + bl.screenY);
      const centreValue = warp.valueAt(cx, cy)[axis] - offset;
      if (centreValue > 0) {
        segments.push([top(), right()]);
        segments.push([bottom(), left()]);
      } else {
        segments.push([top(), left()]);
        segments.push([bottom(), right()]);
      }
      return;
    }
    case 10: {
      // TR+, BL+, TL-, BR-.  Symmetric saddle.
      const cx = 0.25 * (tl.screenX + tr.screenX + br.screenX + bl.screenX);
      const cy = 0.25 * (tl.screenY + tr.screenY + br.screenY + bl.screenY);
      const centreValue = warp.valueAt(cx, cy)[axis] - offset;
      if (centreValue > 0) {
        segments.push([top(), left()]);
        segments.push([bottom(), right()]);
      } else {
        segments.push([top(), right()]);
        segments.push([bottom(), left()]);
      }
      return;
    }
  }
}

function buildSegmentsForLevel(offset, axis, leafCells, warp) {
  const segments = [];
  for (const cell of leafCells) {
    pushCellSegments(segments, cell, axis, offset, warp);
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Seed deduplication
// ---------------------------------------------------------------------------

function createPointIndex(bucketSize) {
  const buckets = new Map();

  function baseBucket(point) {
    return { x: Math.floor(point.x / bucketSize), y: Math.floor(point.y / bucketSize) };
  }

  function bucketKey(xBucket, yBucket) {
    return `${xBucket},${yBucket}`;
  }

  return {
    hasNearby(point, maxDistance) {
      const bucket = baseBucket(point);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const entries = buckets.get(bucketKey(bucket.x + dx, bucket.y + dy));
          if (!entries) continue;
          for (const otherPoint of entries) {
            if (distance(point, otherPoint) <= maxDistance) return true;
          }
        }
      }
      return false;
    },
    addPoint(point) {
      const bucket = baseBucket(point);
      const key = bucketKey(bucket.x, bucket.y);
      let list = buckets.get(key);
      if (!list) {
        list = [];
        buckets.set(key, list);
      }
      list.push({ x: point.x, y: point.y });
    },
  };
}

// ---------------------------------------------------------------------------
// Field adapter + contour tracer
// ---------------------------------------------------------------------------

function createFieldContext(warp) {
  const { width, height } = warp.bounds();
  return {
    width,
    height,
    value(axis, offset, x, y) {
      return warp.valueAt(clamp(x, 0, width), clamp(y, 0, height))[axis] - offset;
    },
    gradient(axis, offset, x, y) {
      const j = warp.jacobianAt(clamp(x, 0, width), clamp(y, 0, height));
      return axis === "warpedX"
        ? { x: j.xx, y: j.xy }
        : { x: j.yx, y: j.yy };
    },
  };
}

function projectToContour(field, axis, offset, point) {
  let x = point.x;
  let y = point.y;

  for (let iteration = 0; iteration < MAX_PROJECTION_ITERATIONS; iteration += 1) {
    const value = field.value(axis, offset, x, y);
    if (Math.abs(value) < NEWTON_TOLERANCE) return { x, y };

    const gradient = field.gradient(axis, offset, x, y);
    const normSquared = gradient.x * gradient.x + gradient.y * gradient.y;
    if (normSquared < MIN_GRADIENT_NORM * MIN_GRADIENT_NORM) return null;

    let dx = -value * gradient.x / normSquared;
    let dy = -value * gradient.y / normSquared;
    // Damp: large Newton jumps happen where the field is poorly approximated
    // linearly, so cap displacement to keep the iterate inside the basin of
    // convergence.
    const displacement = Math.hypot(dx, dy);
    if (displacement > MAX_NEWTON_DISPLACEMENT) {
      const scale = MAX_NEWTON_DISPLACEMENT / displacement;
      dx *= scale;
      dy *= scale;
    }

    x = clamp(x + dx, 0, field.width);
    y = clamp(y + dy, 0, field.height);
  }

  return Math.abs(field.value(axis, offset, x, y)) < NEWTON_TOLERANCE * 4 ? { x, y } : null;
}

function tangentFromGradient(gradient, previousTangent) {
  const tangent = normalize({ x: -gradient.y, y: gradient.x });
  if (!tangent) return null;
  if (previousTangent && dot(tangent, previousTangent) < 0) {
    return { x: -tangent.x, y: -tangent.y };
  }
  return tangent;
}

function isOnBoundary(point, field) {
  return point.x <= 0.5
    || point.x >= field.width - 0.5
    || point.y <= 0.5
    || point.y >= field.height - 0.5;
}

// Single-knob arc-length step controller:
//   h_{k+1} = clamp(h_k * sqrt(tau / correction), TRACE_MIN_STEP, MAX_TRACE_STEP)
// Steps exceeding the turn budget or that fail projection are halved and retried.
function traceDirection(field, axis, offset, seedSample, direction) {
  const seedDirectionTangent = {
    x: seedSample.tangent.x * direction,
    y: seedSample.tangent.y * direction,
  };
  let current = {
    x: seedSample.x,
    y: seedSample.y,
    tangent: seedDirectionTangent,
  };
  let step = INITIAL_TRACE_STEP;
  let arcLength = 0;
  const samples = [];

  for (let iteration = 0; iteration < MAX_TRACE_STEPS; iteration += 1) {
    let attempt = step;
    let accepted = null;

    while (attempt >= TRACE_MIN_STEP) {
      const midpointGuess = {
        x: current.x + current.tangent.x * attempt * 0.5,
        y: current.y + current.tangent.y * attempt * 0.5,
      };
      const projectedMidpoint = projectToContour(field, axis, offset, midpointGuess);
      if (!projectedMidpoint) { attempt *= 0.5; continue; }

      const midpointGradient = field.gradient(axis, offset, projectedMidpoint.x, projectedMidpoint.y);
      if (Math.hypot(midpointGradient.x, midpointGradient.y) < MIN_GRADIENT_NORM) { attempt *= 0.5; continue; }

      const midpointTangent = tangentFromGradient(midpointGradient, current.tangent);
      if (!midpointTangent) { attempt *= 0.5; continue; }

      const predicted = {
        x: current.x + midpointTangent.x * attempt,
        y: current.y + midpointTangent.y * attempt,
      };
      const projected = projectToContour(field, axis, offset, predicted);
      if (!projected) { attempt *= 0.5; continue; }

      const gradient = field.gradient(axis, offset, projected.x, projected.y);
      if (Math.hypot(gradient.x, gradient.y) < MIN_GRADIENT_NORM) { attempt *= 0.5; continue; }

      const tangent = tangentFromGradient(gradient, current.tangent);
      if (!tangent) { attempt *= 0.5; continue; }

      const correction = distance(predicted, projected);
      const turn = Math.acos(clamp(dot(current.tangent, tangent), -1, 1));
      if (turn > MAX_TRACE_TURN || correction > TRACE_TARGET_CORRECTION * 3) {
        attempt *= 0.5;
        continue;
      }

      accepted = { x: projected.x, y: projected.y, tangent };
      const safeCorrection = Math.max(correction, TRACE_TARGET_CORRECTION * 0.01);
      const stepFactor = clamp(Math.sqrt(TRACE_TARGET_CORRECTION / safeCorrection), 0.3, 2);
      step = clamp(attempt * stepFactor, TRACE_MIN_STEP, MAX_TRACE_STEP);
      break;
    }

    if (!accepted) return { samples, closed: false };

    arcLength += distance(current, accepted);
    if (arcLength > MIN_LOOP_ARC_LENGTH
        && distance(accepted, seedSample) < LOOP_CLOSURE_DISTANCE
        && dot(accepted.tangent, seedDirectionTangent) > 0.5) {
      return { samples, closed: true };
    }

    samples.push(accepted);
    current = accepted;

    if (isOnBoundary(current, field) && arcLength > INITIAL_TRACE_STEP) {
      return { samples, closed: false };
    }
  }

  return { samples, closed: false };
}

function traceContourComponent(field, axis, offset, seed) {
  const projectedSeed = projectToContour(field, axis, offset, seed);
  if (!projectedSeed) return null;

  const seedGradient = field.gradient(axis, offset, projectedSeed.x, projectedSeed.y);
  if (Math.hypot(seedGradient.x, seedGradient.y) < MIN_GRADIENT_NORM) return null;

  // Seed tangent orientation is arbitrary; both directions are traced.
  const seedTangent = tangentFromGradient(seedGradient, null);
  if (!seedTangent) return null;

  const seedSample = { x: projectedSeed.x, y: projectedSeed.y, tangent: seedTangent };
  const forward = traceDirection(field, axis, offset, seedSample, 1);
  if (forward.closed) return { closed: true, samples: [seedSample, ...forward.samples] };

  const backward = traceDirection(field, axis, offset, seedSample, -1);
  if (backward.closed) return { closed: true, samples: [seedSample, ...backward.samples] };

  const samples = [...reverseSamples(backward.samples), seedSample, ...forward.samples];
  return samples.length > 1 ? { closed: false, samples } : null;
}

function collectSeedCandidates(offset, axis, leafCells, warp) {
  const segments = buildSegmentsForLevel(offset, axis, leafCells, warp);
  const seedIndex = createPointIndex(SEED_DEDUP_DISTANCE * 2);
  const seeds = [];
  for (const [startPoint, endPoint] of segments) {
    const seed = {
      x: 0.5 * (startPoint.x + endPoint.x),
      y: 0.5 * (startPoint.y + endPoint.y),
    };
    if (seedIndex.hasNearby(seed, SEED_DEDUP_DISTANCE)) continue;
    seedIndex.addPoint(seed);
    seeds.push(seed);
  }
  return seeds;
}

// ---------------------------------------------------------------------------
// SVG output
// ---------------------------------------------------------------------------

function formatNumber(value) {
  return value.toFixed(PATH_DECIMALS);
}

function rotateSamples(samples, startIndex) {
  return samples.slice(startIndex).concat(samples.slice(0, startIndex));
}

function directionBetween(start, end) {
  return normalize({ x: end.x - start.x, y: end.y - start.y });
}

function sampleTurnAngle(previousPoint, point, nextPoint) {
  const incoming = directionBetween(previousPoint, point);
  const outgoing = directionBetween(point, nextPoint);
  if (!incoming || !outgoing) return Math.PI;
  return Math.acos(clamp(dot(incoming, outgoing), -1, 1));
}

function chooseClosedPathSeam(samples) {
  if (samples.length < 3) return 0;
  let bestIndex = 0;
  let bestTurn = Infinity;
  for (let index = 0; index < samples.length; index += 1) {
    const previous = samples[(index - 1 + samples.length) % samples.length];
    const current = samples[index];
    const next = samples[(index + 1) % samples.length];
    const turn = sampleTurnAngle(previous, current, next);
    if (turn < bestTurn) {
      bestTurn = turn;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function preparePathSamples(component) {
  if (!component.closed) return component.samples;
  const seamIndex = chooseClosedPathSeam(component.samples);
  const rotated = rotateSamples(component.samples, seamIndex);
  const first = rotated[0];
  return [
    ...rotated,
    { x: first.x, y: first.y, tangent: { x: first.tangent.x, y: first.tangent.y } },
  ];
}

function createPathData(component) {
  const samples = preparePathSamples(component);
  if (samples.length < 2) return "";

  let pathData = `M ${formatNumber(samples[0].x)} ${formatNumber(samples[0].y)}`;
  const segmentCount = samples.length - 1;

  for (let index = 0; index < segmentCount; index += 1) {
    const start = samples[index];
    const end = samples[index + 1];
    const segmentLength = distance(start, end);
    const handleLength = segmentLength / 3;
    const control1 = {
      x: start.x + start.tangent.x * handleLength,
      y: start.y + start.tangent.y * handleLength,
    };
    const control2 = {
      x: end.x - end.tangent.x * handleLength,
      y: end.y - end.tangent.y * handleLength,
    };
    pathData += ` C ${formatNumber(control1.x)} ${formatNumber(control1.y)} ${formatNumber(control2.x)} ${formatNumber(control2.y)} ${formatNumber(end.x)} ${formatNumber(end.y)}`;
  }

  if (component.closed) pathData += " Z";
  return pathData;
}

function createPathElement(component, stroke) {
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", stroke);
  path.setAttribute("stroke-width", String(STROKE_WIDTH));
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("vector-effect", "non-scaling-stroke");
  path.dataset.closed = String(component.closed);
  path.setAttribute("d", createPathData(component));
  return path;
}

function appendContourFamily(group, offsets, axis, stroke, leafCells, field, warp) {
  for (const offset of offsets) {
    const seeds = collectSeedCandidates(offset, axis, leafCells, warp);
    const visitedSeeds = createPointIndex(VISITED_BUCKET_SIZE);

    for (const seed of seeds) {
      if (visitedSeeds.hasNearby(seed, VISITED_SEED_DISTANCE)) continue;

      const component = traceContourComponent(field, axis, offset, seed);
      if (!component) continue;

      for (const sample of component.samples) {
        visitedSeeds.addPoint(sample);
      }
      group.appendChild(createPathElement(component, stroke));
    }
  }
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function syncTimeControls() {
  const formattedTime = currentTime.toFixed(1);
  timeSlider.value = formattedTime;
  timeInput.value = formattedTime;
  timeValue.textContent = formattedTime;
}

function setCurrentTime(nextTime) {
  if (!Number.isFinite(nextTime)) {
    syncTimeControls();
    return;
  }
  const clampedTime = clamp(nextTime, minTime, maxTime);
  if (clampedTime === currentTime) {
    syncTimeControls();
    return;
  }
  currentTime = clampedTime;
  render();
}

function commitTimeInputValue() {
  const rawValue = timeInput.value.trim();
  if (rawValue === "") {
    syncTimeControls();
    return;
  }
  setCurrentTime(Number(rawValue));
}

function smallestLeafSize(leafCells) {
  let smallest = Infinity;
  for (const cell of leafCells) {
    const w = cell.tr.screenX - cell.tl.screenX;
    const h = cell.bl.screenY - cell.tl.screenY;
    smallest = Math.min(smallest, w, h);
  }
  return Number.isFinite(smallest) ? smallest : MAX_CONTOUR_CELL_SIZE;
}

function render() {
  const stage = scene.parentElement;
  const width = stage.clientWidth;
  const height = stage.clientHeight;

  const warp = createCenteredRadialWarp(width, height, currentTime);
  const field = createFieldContext(warp);
  const leafCells = collectLeafCells(width, height, warp);

  scene.setAttribute("viewBox", `0 0 ${width} ${height}`);
  scene.replaceChildren();

  const limit = maxWarpedRadius(width, height, currentTime);
  const offsets = lineOffsets(limit);
  const horizontalGroup = document.createElementNS(SVG_NS, "g");
  const verticalGroup = document.createElementNS(SVG_NS, "g");

  appendContourFamily(horizontalGroup, offsets, "warpedY", "#d4372f", leafCells, field, warp);
  appendContourFamily(verticalGroup, offsets, "warpedX", "#148a45", leafCells, field, warp);

  scene.append(horizontalGroup, verticalGroup);
  syncTimeControls();
  caption.textContent = `static sample at t=${currentTime.toFixed(1)} · ${offsets.length} lines per axis · ${leafCells.length} leaf cells, smallest ${smallestLeafSize(leafCells).toFixed(1)}px`;
}

timeSlider.addEventListener("input", (event) => {
  setCurrentTime(Number(event.target.value));
});

timeInput.addEventListener("change", () => {
  commitTimeInputValue();
});

timeInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  commitTimeInputValue();
});

const resizeObserver = new ResizeObserver(() => { render(); });

resizeObserver.observe(scene.parentElement);
render();

window.addEventListener("beforeunload", () => {
  resizeObserver.disconnect();
});
