const DEFAULT_TIME = 16.0;
const MAX_CONTOUR_CELL_SIZE = 8;
const MIN_CONTOUR_CELL_SIZE = 3;
const CURVATURE_ERROR_THRESHOLD = 0.02;
const MAX_ADAPTIVE_DEPTH = 3;
const GRID_OFFSET = 0.5;
const STROKE_WIDTH = 2.2;
const FIELD_EPSILON = 0.75;
const MIN_GRADIENT_NORM = 1e-4;
const NEWTON_TOLERANCE = 1e-3;
const MAX_PROJECTION_ITERATIONS = 10;
const INITIAL_TRACE_STEP = 4;
const MAX_TRACE_STEP = 8;
const MIN_TRACE_STEP = 0.35;
const MAX_TRACE_TURN = Math.PI / 3;
const MAX_TRACE_STEPS = 4000;
const LOOP_CLOSURE_DISTANCE = 3;
const MIN_LOOP_ARC_LENGTH = 40;
const SEED_DEDUP_DISTANCE = 4;
const VISITED_BUCKET_SIZE = 18;
const VISITED_SEED_DISTANCE = 10;
const SAMPLE_KEY_DIGITS = 4;
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

function rotate(point, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: cosine * point.x - sine * point.y,
    y: sine * point.x + cosine * point.y,
  };
}

function centerWeight(radius) {
  return Math.exp(-0.16 * radius * radius);
}

function rotationAngle(radius, time) {
  const weight = centerWeight(radius);
  const curl = time * (0.0022 + 0.01 * weight);
  return curl * weight;
}

function scaleFactor(radius, time) {
  const weight = centerWeight(radius);
  const inwardPull = time * (0.015 + 0.075 * weight);
  return smoothMin(3, 1 + inwardPull * weight, 0.2);
}

function forwardWarp(point, time) {
  const radius = Math.hypot(point.x, point.y);
  const angle = rotationAngle(radius, time);
  const scale = scaleFactor(radius, time);
  const rotated = rotate(point, angle);
  return {
    x: rotated.x * scale,
    y: rotated.y * scale,
  };
}

function screenToP(x, y, width, height) {
  const scale = height / 10;
  return {
    x: (x - width * 0.5) / scale,
    y: (height * 0.5 - y) / scale,
  };
}

function visibleBounds(width, height) {
  return {
    xMax: 5 * width / height,
    yMax: 5,
  };
}

function sampleKey(x, y) {
  return `${x.toFixed(SAMPLE_KEY_DIGITS)},${y.toFixed(SAMPLE_KEY_DIGITS)}`;
}

function maxWarpedRadius(width, height, time) {
  const { xMax, yMax } = visibleBounds(width, height);
  const cornerRadius = Math.hypot(xMax, yMax);
  let maximum = 0;

  for (let step = 0; step <= 256; step += 1) {
    const radius = cornerRadius * step / 256;
    maximum = Math.max(maximum, scaleFactor(radius, time) * radius);
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

function createWarpSampler(width, height, time) {
  const cache = new Map();

  return function sampleWarpNode(screenX, screenY) {
    const clampedX = clamp(screenX, 0, width);
    const clampedY = clamp(screenY, 0, height);
    const key = sampleKey(clampedX, clampedY);
    if (cache.has(key)) {
      return cache.get(key);
    }

    const point = screenToP(clampedX, clampedY, width, height);
    const warped = forwardWarp(point, time);
    const node = {
      screenX: clampedX,
      screenY: clampedY,
      qx: warped.x,
      qy: warped.y,
    };

    cache.set(key, node);
    return node;
  };
}

function coordinateAxis(length, cellSize) {
  const steps = Math.max(2, Math.ceil(length / cellSize));
  const coordinates = [];

  for (let index = 0; index <= steps; index += 1) {
    coordinates.push(length * index / steps);
  }

  return coordinates;
}

function buildWarpGrid(xCoords, yCoords, sampleWarpNode) {
  const columns = xCoords.length - 1;
  const rows = yCoords.length - 1;
  const nodes = [];

  for (let row = 0; row <= rows; row += 1) {
    const currentRow = [];
    const screenY = yCoords[row];

    for (let column = 0; column <= columns; column += 1) {
      currentRow.push(sampleWarpNode(xCoords[column], screenY));
    }

    nodes.push(currentRow);
  }

  return { columns, rows, nodes, xCoords, yCoords };
}

function interpolateZero(nodeA, valueA, nodeB, valueB) {
  const amount = Math.abs(valueA - valueB) < 1e-6 ? 0.5 : clamp(valueA / (valueA - valueB), 0, 1);
  return {
    x: mix(nodeA.screenX, nodeB.screenX, amount),
    y: mix(nodeA.screenY, nodeB.screenY, amount),
  };
}

function pushTriangleSegments(segments, nodeA, valueA, nodeB, valueB, nodeC, valueC) {
  const candidates = [
    [nodeA, valueA, nodeB, valueB],
    [nodeB, valueB, nodeC, valueC],
    [nodeC, valueC, nodeA, valueA],
  ];
  const crossings = [];

  for (const [startNode, startValue, endNode, endValue] of candidates) {
    if (Math.abs(startValue) < 1e-6 && Math.abs(endValue) < 1e-6) {
      continue;
    }

    if (Math.abs(startValue) < 1e-6) {
      crossings.push({ x: startNode.screenX, y: startNode.screenY });
      continue;
    }

    if (Math.abs(endValue) < 1e-6) {
      crossings.push({ x: endNode.screenX, y: endNode.screenY });
      continue;
    }

    if ((startValue > 0) !== (endValue > 0)) {
      crossings.push(interpolateZero(startNode, startValue, endNode, endValue));
    }
  }

  if (crossings.length < 2) {
    return;
  }

  const uniqueCrossings = [];
  for (const crossing of crossings) {
    if (!uniqueCrossings.some((candidate) => Math.hypot(candidate.x - crossing.x, candidate.y - crossing.y) < 1e-4)) {
      uniqueCrossings.push(crossing);
    }
  }

  if (uniqueCrossings.length === 2) {
    segments.push(uniqueCrossings);
  }
}

function axisCurvatureError(topLeft, topRight, bottomRight, bottomLeft, topMid, rightMid, bottomMid, leftMid, center, axisKey) {
  return Math.max(
    Math.abs(center[axisKey] - 0.25 * (topLeft[axisKey] + topRight[axisKey] + bottomRight[axisKey] + bottomLeft[axisKey])),
    Math.abs(topMid[axisKey] - 0.5 * (topLeft[axisKey] + topRight[axisKey])),
    Math.abs(rightMid[axisKey] - 0.5 * (topRight[axisKey] + bottomRight[axisKey])),
    Math.abs(bottomMid[axisKey] - 0.5 * (bottomLeft[axisKey] + bottomRight[axisKey])),
    Math.abs(leftMid[axisKey] - 0.5 * (topLeft[axisKey] + bottomLeft[axisKey])),
  );
}

function cellCurvature(topLeft, topRight, bottomRight, bottomLeft, sampleWarpNode) {
  const midX = 0.5 * (topLeft.screenX + topRight.screenX);
  const midY = 0.5 * (topLeft.screenY + bottomLeft.screenY);
  const topMid = sampleWarpNode(midX, topLeft.screenY);
  const rightMid = sampleWarpNode(topRight.screenX, midY);
  const bottomMid = sampleWarpNode(midX, bottomLeft.screenY);
  const leftMid = sampleWarpNode(topLeft.screenX, midY);
  const center = sampleWarpNode(midX, midY);

  return Math.max(
    axisCurvatureError(topLeft, topRight, bottomRight, bottomLeft, topMid, rightMid, bottomMid, leftMid, center, "qx"),
    axisCurvatureError(topLeft, topRight, bottomRight, bottomLeft, topMid, rightMid, bottomMid, leftMid, center, "qy"),
  );
}

function buildAdaptiveAxes(width, height, sampleWarpNode) {
  let xCoords = coordinateAxis(width, MAX_CONTOUR_CELL_SIZE);
  let yCoords = coordinateAxis(height, MAX_CONTOUR_CELL_SIZE);

  for (let depth = 0; depth < MAX_ADAPTIVE_DEPTH; depth += 1) {
    const warpGrid = buildWarpGrid(xCoords, yCoords, sampleWarpNode);
    const nextX = new Set(xCoords);
    const nextY = new Set(yCoords);
    let refined = false;

    for (let row = 0; row < warpGrid.rows; row += 1) {
      for (let column = 0; column < warpGrid.columns; column += 1) {
        const topLeft = warpGrid.nodes[row][column];
        const topRight = warpGrid.nodes[row][column + 1];
        const bottomRight = warpGrid.nodes[row + 1][column + 1];
        const bottomLeft = warpGrid.nodes[row + 1][column];
        const cellWidth = topRight.screenX - topLeft.screenX;
        const cellHeight = bottomLeft.screenY - topLeft.screenY;

        if (Math.max(cellWidth, cellHeight) * 0.5 < MIN_CONTOUR_CELL_SIZE) {
          continue;
        }

        if (cellCurvature(topLeft, topRight, bottomRight, bottomLeft, sampleWarpNode) <= CURVATURE_ERROR_THRESHOLD) {
          continue;
        }

        nextX.add(0.5 * (topLeft.screenX + topRight.screenX));
        nextY.add(0.5 * (topLeft.screenY + bottomLeft.screenY));
        refined = true;
      }
    }

    if (!refined) {
      break;
    }

    xCoords = Array.from(nextX).sort((left, right) => left - right);
    yCoords = Array.from(nextY).sort((left, right) => left - right);
  }

  return { xCoords, yCoords };
}

function buildSegmentsForLevel(offset, axisKey, warpGrid) {
  const segments = [];

  for (let row = 0; row < warpGrid.rows; row += 1) {
    for (let column = 0; column < warpGrid.columns; column += 1) {
      const topLeft = warpGrid.nodes[row][column];
      const topRight = warpGrid.nodes[row][column + 1];
      const bottomRight = warpGrid.nodes[row + 1][column + 1];
      const bottomLeft = warpGrid.nodes[row + 1][column];

      pushTriangleSegments(
        segments,
        topLeft,
        topLeft[axisKey] - offset,
        topRight,
        topRight[axisKey] - offset,
        bottomRight,
        bottomRight[axisKey] - offset,
      );
      pushTriangleSegments(
        segments,
        topLeft,
        topLeft[axisKey] - offset,
        bottomRight,
        bottomRight[axisKey] - offset,
        bottomLeft,
        bottomLeft[axisKey] - offset,
      );
    }
  }

  return segments;
}

function minAxisStep(coordinates) {
  let minStep = Infinity;

  for (let index = 1; index < coordinates.length; index += 1) {
    minStep = Math.min(minStep, coordinates[index] - coordinates[index - 1]);
  }

  return minStep;
}

function createPointIndex(bucketSize) {
  const buckets = new Map();

  function baseBucket(point) {
    return {
      x: Math.floor(point.x / bucketSize),
      y: Math.floor(point.y / bucketSize),
    };
  }

  function bucketKey(xBucket, yBucket) {
    return `${xBucket},${yBucket}`;
  }

  return {
    hasNearby(point, maxDistance) {
      const bucket = baseBucket(point);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const key = bucketKey(bucket.x + dx, bucket.y + dy);
          const entries = buckets.get(key);
          if (!entries) {
            continue;
          }

          for (const otherPoint of entries) {
            if (distance(point, otherPoint) <= maxDistance) {
              return true;
            }
          }
        }
      }

      return false;
    },
    addPoint(point) {
      const bucket = baseBucket(point);
      const key = bucketKey(bucket.x, bucket.y);
      if (!buckets.has(key)) {
        buckets.set(key, []);
      }

      buckets.get(key).push({ x: point.x, y: point.y });
    },
  };
}

function createFieldContext(width, height, sampleWarpNode) {
  function axisValue(axisKey, x, y) {
    return sampleWarpNode(clamp(x, 0, width), clamp(y, 0, height))[axisKey];
  }

  return {
    width,
    height,
    value(axisKey, offset, x, y) {
      return axisValue(axisKey, x, y) - offset;
    },
    gradient(axisKey, offset, x, y) {
      const x0 = clamp(x - FIELD_EPSILON, 0, width);
      const x1 = clamp(x + FIELD_EPSILON, 0, width);
      const y0 = clamp(y - FIELD_EPSILON, 0, height);
      const y1 = clamp(y + FIELD_EPSILON, 0, height);
      const gx = (this.value(axisKey, offset, x1, y) - this.value(axisKey, offset, x0, y)) / Math.max(1e-6, x1 - x0);
      const gy = (this.value(axisKey, offset, x, y1) - this.value(axisKey, offset, x, y0)) / Math.max(1e-6, y1 - y0);
      return { x: gx, y: gy };
    },
  };
}

function projectToContour(field, axisKey, offset, point) {
  let x = point.x;
  let y = point.y;

  for (let iteration = 0; iteration < MAX_PROJECTION_ITERATIONS; iteration += 1) {
    const value = field.value(axisKey, offset, x, y);
    if (Math.abs(value) < NEWTON_TOLERANCE) {
      return { x, y };
    }

    const gradient = field.gradient(axisKey, offset, x, y);
    const normSquared = gradient.x * gradient.x + gradient.y * gradient.y;
    if (normSquared < MIN_GRADIENT_NORM * MIN_GRADIENT_NORM) {
      return null;
    }

    x = clamp(x - value * gradient.x / normSquared, 0, field.width);
    y = clamp(y - value * gradient.y / normSquared, 0, field.height);
  }

  return Math.abs(field.value(axisKey, offset, x, y)) < NEWTON_TOLERANCE * 4 ? { x, y } : null;
}

function tangentFromGradient(gradient, previousTangent) {
  const tangent = normalize({ x: -gradient.y, y: gradient.x });
  if (!tangent) {
    return null;
  }

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

function traceDirection(field, axisKey, offset, seedSample, direction) {
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
    let localStep = step;
    let accepted = null;

    while (localStep >= MIN_TRACE_STEP) {
      const midpointGuess = {
        x: current.x + current.tangent.x * localStep * 0.5,
        y: current.y + current.tangent.y * localStep * 0.5,
      };
      const projectedMidpoint = projectToContour(field, axisKey, offset, midpointGuess);
      if (!projectedMidpoint) {
        localStep *= 0.5;
        continue;
      }

      const midpointGradient = field.gradient(axisKey, offset, projectedMidpoint.x, projectedMidpoint.y);
      if (Math.hypot(midpointGradient.x, midpointGradient.y) < MIN_GRADIENT_NORM) {
        localStep *= 0.5;
        continue;
      }

      const midpointTangent = tangentFromGradient(midpointGradient, current.tangent);
      if (!midpointTangent) {
        localStep *= 0.5;
        continue;
      }

      const predicted = {
        x: current.x + midpointTangent.x * localStep,
        y: current.y + midpointTangent.y * localStep,
      };
      const projected = projectToContour(field, axisKey, offset, predicted);
      if (!projected) {
        localStep *= 0.5;
        continue;
      }

      const gradient = field.gradient(axisKey, offset, projected.x, projected.y);
      if (Math.hypot(gradient.x, gradient.y) < MIN_GRADIENT_NORM) {
        localStep *= 0.5;
        continue;
      }

      const tangent = tangentFromGradient(gradient, current.tangent);
      if (!tangent) {
        localStep *= 0.5;
        continue;
      }

      const advance = distance(current, projected);
      const correction = distance(predicted, projected);
      const turn = Math.acos(clamp(dot(current.tangent, tangent), -1, 1));
      if (advance < MIN_TRACE_STEP * 0.25 || correction > localStep * 0.85 || turn > MAX_TRACE_TURN) {
        localStep *= 0.5;
        continue;
      }

      accepted = {
        x: projected.x,
        y: projected.y,
        tangent,
      };
      step = correction < localStep * 0.2 && turn < 0.15
        ? Math.min(localStep * 1.2, MAX_TRACE_STEP)
        : localStep;
      break;
    }

    if (!accepted) {
      return { samples, closed: false };
    }

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

function traceContourComponent(field, axisKey, offset, seed) {
  const projectedSeed = projectToContour(field, axisKey, offset, seed);
  if (!projectedSeed) {
    return null;
  }

  const seedGradient = field.gradient(axisKey, offset, projectedSeed.x, projectedSeed.y);
  if (Math.hypot(seedGradient.x, seedGradient.y) < MIN_GRADIENT_NORM) {
    return null;
  }

  const seedTangent = tangentFromGradient(seedGradient, null);
  if (!seedTangent) {
    return null;
  }

  const seedSample = {
    x: projectedSeed.x,
    y: projectedSeed.y,
    tangent: seedTangent,
  };
  const forward = traceDirection(field, axisKey, offset, seedSample, 1);
  if (forward.closed) {
    return {
      closed: true,
      samples: [seedSample, ...forward.samples],
    };
  }

  const backward = traceDirection(field, axisKey, offset, seedSample, -1);
  if (backward.closed) {
    return {
      closed: true,
      samples: [seedSample, ...backward.samples],
    };
  }

  const samples = [...reverseSamples(backward.samples), seedSample, ...forward.samples];
  return samples.length > 1
    ? { closed: false, samples }
    : null;
}

function collectSeedCandidates(offset, axisKey, warpGrid) {
  const segments = buildSegmentsForLevel(offset, axisKey, warpGrid);
  const seedIndex = createPointIndex(SEED_DEDUP_DISTANCE * 2);
  const seeds = [];

  for (const [startPoint, endPoint] of segments) {
    const seed = {
      x: 0.5 * (startPoint.x + endPoint.x),
      y: 0.5 * (startPoint.y + endPoint.y),
    };
    if (seedIndex.hasNearby(seed, SEED_DEDUP_DISTANCE)) {
      continue;
    }

    seedIndex.addPoint(seed);
    seeds.push(seed);
  }

  return seeds;
}

function formatNumber(value) {
  return value.toFixed(PATH_DECIMALS);
}

function rotateSamples(samples, startIndex) {
  return samples.slice(startIndex).concat(samples.slice(0, startIndex));
}

function directionBetween(start, end) {
  return normalize({
    x: end.x - start.x,
    y: end.y - start.y,
  });
}

function sampleTurnAngle(previousPoint, point, nextPoint) {
  const incoming = directionBetween(previousPoint, point);
  const outgoing = directionBetween(point, nextPoint);
  if (!incoming || !outgoing) {
    return Math.PI;
  }

  return Math.acos(clamp(dot(incoming, outgoing), -1, 1));
}

function chooseClosedFitSeam(samples) {
  if (samples.length < 3) {
    return 0;
  }

  let bestIndex = 0;
  let bestScore = Infinity;

  for (let index = 0; index < samples.length; index += 1) {
    const previous = samples[(index - 1 + samples.length) % samples.length];
    const current = samples[index];
    const next = samples[(index + 1) % samples.length];
    const turn = sampleTurnAngle(previous, current, next);
    const localScale = Math.min(distance(previous, current), distance(current, next));
    const score = turn + 1 / Math.max(localScale, 1e-3);
    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function createWorkingSamples(component) {
  if (!component.closed) {
    return {
      samples: component.samples,
      closed: false,
    };
  }

  const seamIndex = chooseClosedFitSeam(component.samples);
  const rotated = rotateSamples(component.samples, seamIndex);
  const first = rotated[0];
  return {
    samples: [
      ...rotated,
      {
        x: first.x,
        y: first.y,
        tangent: { x: first.tangent.x, y: first.tangent.y },
      },
    ],
    closed: true,
  };
}

function createPathData(component) {
  const working = createWorkingSamples(component);
  const { samples } = working;
  if (samples.length < 2) {
    return "";
  }

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

  if (component.closed) {
    pathData += " Z";
  }

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

function appendContourFamily(group, offsets, axisKey, stroke, warpGrid, field) {
  for (const offset of offsets) {
    const seeds = collectSeedCandidates(offset, axisKey, warpGrid);
    const visitedSeeds = createPointIndex(VISITED_BUCKET_SIZE);

    for (const seed of seeds) {
      if (visitedSeeds.hasNearby(seed, VISITED_SEED_DISTANCE)) {
        continue;
      }

      const component = traceContourComponent(field, axisKey, offset, seed);
      if (!component) {
        continue;
      }

      for (const sample of component.samples) {
        visitedSeeds.addPoint(sample);
      }

      group.appendChild(createPathElement(component, stroke));
    }
  }
}

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

function render() {
  const stage = scene.parentElement;
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  const sampleWarpNode = createWarpSampler(width, height, currentTime);
  const field = createFieldContext(width, height, sampleWarpNode);
  const { xCoords, yCoords } = buildAdaptiveAxes(width, height, sampleWarpNode);
  const warpGrid = buildWarpGrid(xCoords, yCoords, sampleWarpNode);

  scene.setAttribute("viewBox", `0 0 ${width} ${height}`);
  scene.replaceChildren();

  const limit = maxWarpedRadius(width, height, currentTime);
  const offsets = lineOffsets(limit);
  const horizontalGroup = document.createElementNS(SVG_NS, "g");
  const verticalGroup = document.createElementNS(SVG_NS, "g");

  appendContourFamily(horizontalGroup, offsets, "qy", "#d4372f", warpGrid, field);
  appendContourFamily(verticalGroup, offsets, "qx", "#148a45", warpGrid, field);

  const minCellSize = Math.min(minAxisStep(xCoords), minAxisStep(yCoords));

  scene.append(horizontalGroup, verticalGroup);
  syncTimeControls();
  caption.textContent = `static sample at t=${currentTime.toFixed(1)} · ${offsets.length} lines per axis · traced paths from adaptive ${MAX_CONTOUR_CELL_SIZE}px to ${minCellSize.toFixed(1)}px seeds`;
}

timeSlider.addEventListener("input", (event) => {
  setCurrentTime(Number(event.target.value));
});

timeInput.addEventListener("change", () => {
  commitTimeInputValue();
});

timeInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") {
    return;
  }

  event.preventDefault();
  commitTimeInputValue();
});

const resizeObserver = new ResizeObserver(() => {
  render();
});

resizeObserver.observe(scene.parentElement);
render();

window.addEventListener("beforeunload", () => {
  resizeObserver.disconnect();
});
