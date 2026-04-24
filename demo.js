const DEFAULT_TIME = 16.0;
const GRID_OFFSET = 0.5;
const SAMPLE_COUNT = 240;
const STROKE_WIDTH = 2.2;
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

function invertRadius(rho, time) {
  if (rho <= 1e-9) {
    return 0;
  }

  let low = 0;
  let high = Math.max(rho, 1);

  for (let index = 0; index < 10; index += 1) {
    const mapped = scaleFactor(high, time) * high;
    if (mapped >= rho) {
      break;
    }
    high *= 1.5;
  }

  for (let iteration = 0; iteration < 28; iteration += 1) {
    const mid = 0.5 * (low + high);
    const mapped = scaleFactor(mid, time) * mid;
    if (mapped < rho) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return 0.5 * (low + high);
}

function inverseWarp(point, time) {
  const rho = Math.hypot(point.x, point.y);
  if (rho <= 1e-9) {
    return { x: 0, y: 0 };
  }

  const radius = invertRadius(rho, time);
  const psi = Math.atan2(point.y, point.x);
  const phi = psi - rotationAngle(radius, time);

  return {
    x: radius * Math.cos(phi),
    y: radius * Math.sin(phi),
  };
}

function pToScreen(point, width, height) {
  const scale = height / 10;
  return {
    x: width * 0.5 + point.x * scale,
    y: height * 0.5 - point.y * scale,
  };
}

function visibleBounds(width, height) {
  return {
    xMax: 5 * width / height,
    yMax: 5,
  };
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

function buildPolylinePoints(offset, orientation, limit, width, height, time) {
  const points = [];

  for (let step = 0; step < SAMPLE_COUNT; step += 1) {
    const t = SAMPLE_COUNT === 1 ? 0 : step / (SAMPLE_COUNT - 1);
    const axisValue = mix(-limit, limit, t);
    const warpedPoint = orientation === "horizontal"
      ? { x: axisValue, y: offset }
      : { x: offset, y: axisValue };
    const screenPoint = pToScreen(inverseWarp(warpedPoint, time), width, height);
    points.push(`${screenPoint.x.toFixed(2)},${screenPoint.y.toFixed(2)}`);
  }

  return points.join(" ");
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

function render() {
  const stage = scene.parentElement;
  const width = stage.clientWidth;
  const height = stage.clientHeight;

  scene.setAttribute("viewBox", `0 0 ${width} ${height}`);
  scene.replaceChildren();

  const limit = maxWarpedRadius(width, height, currentTime);
  const offsets = lineOffsets(limit);
  const horizontalGroup = document.createElementNS(SVG_NS, "g");
  const verticalGroup = document.createElementNS(SVG_NS, "g");

  for (const offset of offsets) {
    horizontalGroup.appendChild(
      createPolyline(
        buildPolylinePoints(offset, "horizontal", limit, width, height, currentTime),
        "#d4372f",
      ),
    );
  }

  for (const offset of offsets) {
    verticalGroup.appendChild(
      createPolyline(
        buildPolylinePoints(offset, "vertical", limit, width, height, currentTime),
        "#148a45",
      ),
    );
  }

  scene.append(horizontalGroup, verticalGroup);
  timeValue.value = currentTime.toFixed(1);
  timeValue.textContent = currentTime.toFixed(1);
  caption.textContent = `static sample at t=${currentTime.toFixed(1)} · ${offsets.length} lines per axis · ${SAMPLE_COUNT} samples per line`;
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
