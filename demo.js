const DEFAULT_TIME = 16.0;
const MAX_CONTOUR_CELL_SIZE = 8;
const MIN_CONTOUR_CELL_SIZE = 3;
const GRID_OFFSET = 0.5;
const STROKE_WIDTH = 2.2;
const MIN_BRANCH_POINTS = 6;
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

function contourCellSize(time) {
  return Math.max(MIN_CONTOUR_CELL_SIZE, MAX_CONTOUR_CELL_SIZE - 0.08 * time);
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

function buildWarpGrid(width, height, time, cellSize) {
  const columns = Math.max(2, Math.ceil(width / cellSize));
  const rows = Math.max(2, Math.ceil(height / cellSize));
  const nodes = [];

  for (let row = 0; row <= rows; row += 1) {
    const currentRow = [];
    const screenY = height * row / rows;

    for (let column = 0; column <= columns; column += 1) {
      const screenX = width * column / columns;
      const point = screenToP(screenX, screenY, width, height);
      const warped = forwardWarp(point, time);
      currentRow.push({
        screenX,
        screenY,
        qx: warped.x,
        qy: warped.y,
      });
    }

    nodes.push(currentRow);
  }

  return { columns, rows, nodes };
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

function buildPointKey(point) {
  return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
}

function edgeKey(startKey, endKey) {
  return startKey < endKey ? `${startKey}|${endKey}` : `${endKey}|${startKey}`;
}

function traceSegments(segments) {
  const vertices = new Map();
  const edges = new Map();

  function ensureVertex(point) {
    const key = buildPointKey(point);
    if (!vertices.has(key)) {
      vertices.set(key, { x: point.x, y: point.y, neighbors: [] });
    }
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
  const cellSize = contourCellSize(currentTime);
  // Sample the warped coordinate field on a screen-space lattice, then extract
  // iso-lines where qx or qy land on half-integer grid coordinates.
  const warpGrid = buildWarpGrid(width, height, currentTime, cellSize);

  scene.setAttribute("viewBox", `0 0 ${width} ${height}`);
  scene.replaceChildren();

  const limit = maxWarpedRadius(width, height, currentTime);
  const offsets = lineOffsets(limit);
  const horizontalGroup = document.createElementNS(SVG_NS, "g");
  const verticalGroup = document.createElementNS(SVG_NS, "g");

  appendContourFamily(horizontalGroup, offsets, "horizontal", "#d4372f", warpGrid);
  appendContourFamily(verticalGroup, offsets, "vertical", "#148a45", warpGrid);

  scene.append(horizontalGroup, verticalGroup);
  timeValue.value = currentTime.toFixed(1);
  timeValue.textContent = currentTime.toFixed(1);
  caption.textContent = `static sample at t=${currentTime.toFixed(1)} · ${offsets.length} lines per axis · contour cell ${cellSize.toFixed(1)}px`;
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
