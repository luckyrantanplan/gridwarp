const DEFAULT_TIME = 16.0;
const MAX_CONTOUR_CELL_SIZE = 8;
const MIN_CONTOUR_CELL_SIZE = 3;
const CURVATURE_ERROR_THRESHOLD = 0.02;
const MAX_ADAPTIVE_DEPTH = 3;
const GRID_OFFSET = 0.5;
const STROKE_WIDTH = 2.2;
const MIN_BRANCH_POINTS = 6;
const VERTEX_MERGE_TOLERANCE = 1.25;
const SVG_NS = "http://www.w3.org/2000/svg";

const scene = document.getElementById("scene");
const caption = document.getElementById("caption");
const timeSlider = document.getElementById("time-slider");
const timeValue = document.getElementById("time-value");

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

function pToScreen(point, width, height) {
  const scale = height / 10;
  return {
    x: width * 0.5 + point.x * scale,
    y: height * 0.5 - point.y * scale,
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
  return `${x.toFixed(4)},${y.toFixed(4)}`;
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
    const key = sampleKey(screenX, screenY);
    if (cache.has(key)) {
      return cache.get(key);
    }

    const point = screenToP(screenX, screenY, width, height);
    const warped = forwardWarp(point, time);
    const node = {
      screenX,
      screenY,
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
      const screenX = xCoords[column];
      currentRow.push(sampleWarpNode(screenX, screenY));
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
  // Each triangle contributes at most one contour segment for a single grid level.
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

  return {
    maxError: Math.max(
      axisCurvatureError(topLeft, topRight, bottomRight, bottomLeft, topMid, rightMid, bottomMid, leftMid, center, "qx"),
      axisCurvatureError(topLeft, topRight, bottomRight, bottomLeft, topMid, rightMid, bottomMid, leftMid, center, "qy"),
    ),
  };
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

        const metrics = cellCurvature(topLeft, topRight, bottomRight, bottomLeft, sampleWarpNode);
        if (metrics.maxError <= CURVATURE_ERROR_THRESHOLD) {
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

function buildSegmentsForOffset(offset, orientation, warpGrid) {
  const axisKey = orientation === "horizontal" ? "qy" : "qx";
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

function edgeKey(startKey, endKey) {
  return startKey < endKey ? `${startKey}|${endKey}` : `${endKey}|${startKey}`;
}

function traceSegments(segments) {
  const vertices = new Map();
  const edges = new Map();
  const spatialBuckets = new Map();
  let nextVertexId = 0;

  function ensureVertex(point) {
    const bucketX = Math.round(point.x / VERTEX_MERGE_TOLERANCE);
    const bucketY = Math.round(point.y / VERTEX_MERGE_TOLERANCE);

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucketKey = `${bucketX + dx},${bucketY + dy}`;
        const bucket = spatialBuckets.get(bucketKey);

        if (!bucket) {
          continue;
        }

        for (const key of bucket) {
          const vertex = vertices.get(key);
          if (Math.hypot(vertex.x - point.x, vertex.y - point.y) <= VERTEX_MERGE_TOLERANCE) {
            return key;
          }
        }
      }
    }

    const key = String(nextVertexId);
    nextVertexId += 1;
    vertices.set(key, { x: point.x, y: point.y, neighbors: [] });

    const homeBucketKey = `${bucketX},${bucketY}`;
    if (!spatialBuckets.has(homeBucketKey)) {
      spatialBuckets.set(homeBucketKey, []);
    }

    spatialBuckets.get(homeBucketKey).push(key);
    return key;
  }

  for (const [startPoint, endPoint] of segments) {
    const startKey = ensureVertex(startPoint);
    const endKey = ensureVertex(endPoint);
    const key = edgeKey(startKey, endKey);

    if (edges.has(key) || startKey === endKey) {
      continue;
    }

    edges.set(key, { startKey, endKey, used: false });
    vertices.get(startKey).neighbors.push(endKey);
    vertices.get(endKey).neighbors.push(startKey);
  }

  const polylines = [];

  function consumePath(startKey) {
    // Walk the contour graph edge-by-edge to rebuild ordered SVG polyline points.
    const points = [];
    let previousKey = null;
    let currentKey = startKey;

    while (currentKey) {
      const currentVertex = vertices.get(currentKey);
      points.push(`${currentVertex.x.toFixed(2)},${currentVertex.y.toFixed(2)}`);

      const nextKey = currentVertex.neighbors.find((neighborKey) => {
        const key = edgeKey(currentKey, neighborKey);
        return !edges.get(key).used && neighborKey !== previousKey;
      });

      if (!nextKey) {
        break;
      }

      edges.get(edgeKey(currentKey, nextKey)).used = true;
      previousKey = currentKey;
      currentKey = nextKey;

      if (currentKey === startKey) {
        const startVertex = vertices.get(startKey);
        points.push(`${startVertex.x.toFixed(2)},${startVertex.y.toFixed(2)}`);
        break;
      }
    }

    return points;
  }

  for (const [key, vertex] of vertices) {
    if (vertex.neighbors.length !== 1) {
      continue;
    }

    const neighborKey = vertex.neighbors[0];
    if (edges.get(edgeKey(key, neighborKey)).used) {
      continue;
    }

    const points = consumePath(key);
    if (points.length >= MIN_BRANCH_POINTS) {
      polylines.push(points.join(" "));
    }
  }

  for (const edge of edges.values()) {
    if (edge.used) {
      continue;
    }

    const points = consumePath(edge.startKey);
    if (points.length >= MIN_BRANCH_POINTS) {
      polylines.push(points.join(" "));
    }
  }

  return polylines;
}

function createPolyline(points, stroke) {
  const polyline = document.createElementNS(SVG_NS, "polyline");
  polyline.setAttribute("fill", "none");
  polyline.setAttribute("stroke", stroke);
  polyline.setAttribute("stroke-width", String(STROKE_WIDTH));
  polyline.setAttribute("stroke-linecap", "round");
  polyline.setAttribute("stroke-linejoin", "round");
  polyline.setAttribute("vector-effect", "non-scaling-stroke");
  polyline.setAttribute("points", points);
  return polyline;
}

function appendContourFamily(group, offsets, orientation, stroke, warpGrid) {
  for (const offset of offsets) {
    const segments = buildSegmentsForOffset(offset, orientation, warpGrid);
    const pointSets = traceSegments(segments);

    for (const points of pointSets) {
      group.appendChild(createPolyline(points, stroke));
    }
  }
}

function render() {
  const stage = scene.parentElement;
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  const sampleWarpNode = createWarpSampler(width, height, currentTime);
  const { xCoords, yCoords } = buildAdaptiveAxes(width, height, sampleWarpNode);
  // Sample the warped coordinate field on a screen-space lattice, then extract
  // iso-lines where qx or qy land on half-integer grid coordinates.
  const warpGrid = buildWarpGrid(xCoords, yCoords, sampleWarpNode);

  scene.setAttribute("viewBox", `0 0 ${width} ${height}`);
  scene.replaceChildren();

  const limit = maxWarpedRadius(width, height, currentTime);
  const offsets = lineOffsets(limit);
  const horizontalGroup = document.createElementNS(SVG_NS, "g");
  const verticalGroup = document.createElementNS(SVG_NS, "g");

  appendContourFamily(horizontalGroup, offsets, "horizontal", "#d4372f", warpGrid);
  appendContourFamily(verticalGroup, offsets, "vertical", "#148a45", warpGrid);

  let minCellSize = Infinity;
  for (let index = 1; index < xCoords.length; index += 1) {
    minCellSize = Math.min(minCellSize, xCoords[index] - xCoords[index - 1]);
  }
  for (let index = 1; index < yCoords.length; index += 1) {
    minCellSize = Math.min(minCellSize, yCoords[index] - yCoords[index - 1]);
  }

  scene.append(horizontalGroup, verticalGroup);
  timeValue.value = currentTime.toFixed(1);
  timeValue.textContent = currentTime.toFixed(1);
  caption.textContent = `static sample at t=${currentTime.toFixed(1)} · ${offsets.length} lines per axis · adaptive ${MAX_CONTOUR_CELL_SIZE}px to ${minCellSize.toFixed(1)}px`;
}

timeSlider.value = String(DEFAULT_TIME);
timeSlider.addEventListener("input", (event) => {
  currentTime = Number(event.target.value);
  render();
});

const resizeObserver = new ResizeObserver(() => {
  render();
});

resizeObserver.observe(scene.parentElement);
render();

window.addEventListener("beforeunload", () => {
  resizeObserver.disconnect();
});
