import { segmentsFromVertices, type WarpedPolylineShape } from "../render/polyline-overlay.js";
import { PolygonShape, type BoundingBox } from "../lib/polygon-shape.js";
import {
  WARP_GEOMETRY_GROUPS,
  WARP_GEOMETRY_PRESENTATION,
  type WarpGeometryPresentation,
  type WarpGeometry,
  WarpRequestError,
} from "../shared/warp-request.js";

interface Point {
  readonly x: number;
  readonly y: number;
}

export interface ParsedWarpGeometry {
  readonly worldBounds: BoundingBox;
  readonly outerBoundary: readonly Point[];
  readonly outerBoundaryStyle: WarpGeometryPresentation;
  readonly horizontalGrid: readonly WarpedPolylineShape[];
  readonly horizontalGridStyle: WarpGeometryPresentation;
  readonly verticalGrid: readonly WarpedPolylineShape[];
  readonly verticalGridStyle: WarpGeometryPresentation;
  readonly innerBoundary: readonly WarpedPolylineShape[];
  readonly innerBoundaryStyle: WarpGeometryPresentation;
  readonly diagonals: readonly WarpedPolylineShape[];
  readonly diagonalsStyle: WarpGeometryPresentation;
}

interface ParsedPolylineGroup {
  readonly polylines: Point[][];
  readonly style: WarpGeometryPresentation;
}

export function parseGeometrySvg(geometry: WarpGeometry): ParsedWarpGeometry {
  const svgExpression = /^\s*<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/;
  const svgMatch = svgExpression.exec(geometry.svg);
  if (!svgMatch) {
    throw new WarpRequestError("geometry.svg must contain a single svg root element.");
  }

  const worldBounds = parseViewBox(attributeValue(svgMatch[1], "viewBox"));
  const groups = extractGroups(svgMatch[2]);
  const outerBoundaryGroup = parseClosedBoundaryGroup(groups.get(WARP_GEOMETRY_GROUPS.outerBoundary), WARP_GEOMETRY_GROUPS.outerBoundary);
  const innerBoundaryGroup = parseClosedBoundaryGroup(groups.get(WARP_GEOMETRY_GROUPS.innerBoundary), WARP_GEOMETRY_GROUPS.innerBoundary);
  const horizontalGridGroup = parseOpenShapeGroup(groups.get(WARP_GEOMETRY_GROUPS.horizontalGrid), WARP_GEOMETRY_GROUPS.horizontalGrid);
  const verticalGridGroup = parseOpenShapeGroup(groups.get(WARP_GEOMETRY_GROUPS.verticalGrid), WARP_GEOMETRY_GROUPS.verticalGrid);
  const diagonalsGroup = parseOpenShapeGroup(groups.get(WARP_GEOMETRY_GROUPS.diagonals), WARP_GEOMETRY_GROUPS.diagonals);
  const outerBoundary = outerBoundaryGroup.points;
  const innerBoundary = innerBoundaryGroup.points;
  const outerShape = new PolygonShape(outerBoundary);
  ensureBoundaryContains(outerShape, innerBoundary, WARP_GEOMETRY_GROUPS.innerBoundary);

  return {
    worldBounds,
    outerBoundary,
    outerBoundaryStyle: outerBoundaryGroup.style,
    horizontalGrid: horizontalGridGroup.shapes,
    horizontalGridStyle: horizontalGridGroup.style,
    verticalGrid: verticalGridGroup.shapes,
    verticalGridStyle: verticalGridGroup.style,
    innerBoundary: [toClosedShape(innerBoundary)],
    innerBoundaryStyle: innerBoundaryGroup.style,
    diagonals: diagonalsGroup.shapes,
    diagonalsStyle: diagonalsGroup.style,
  };
}

function parseViewBox(viewBoxValue: string | null): BoundingBox {
  if (viewBoxValue === null) {
    throw new WarpRequestError("geometry.svg root must include a viewBox.");
  }

  const tokens = viewBoxValue.trim().split(/[\s,]+/).filter((token) => token.length > 0);
  if (tokens.length !== 4) {
    throw new WarpRequestError("geometry.svg viewBox must contain exactly four numbers.");
  }

  const minX = Number(tokens[0]);
  const minY = Number(tokens[1]);
  const width = Number(tokens[2]);
  const height = Number(tokens[3]);
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new WarpRequestError("geometry.svg viewBox values must be finite numbers.");
  }
  if (width <= 0.0 || height <= 0.0) {
    throw new WarpRequestError("geometry.svg viewBox width and height must be positive.");
  }

  return {
    minX,
    minY,
    maxX: minX + width,
    maxY: minY + height,
  };
}

function extractGroups(svgBody: string): Map<string, string> {
  const groups = new Map<string, string>();
  const groupExpression = /<g\b([^>]*)>([\s\S]*?)<\/g>/g;
  let match = groupExpression.exec(svgBody);
  while (match !== null) {
    const attributes = match[1];
    const id = attributeValue(attributes, "id");
    if (id !== null) {
      groups.set(id, match[2]);
    }
    match = groupExpression.exec(svgBody);
  }
  return groups;
}

function parseClosedBoundaryGroup(groupContent: string | undefined, groupId: string): { points: Point[]; style: WarpGeometryPresentation } {
  const group = parsePolylineGroup(groupContent, groupId);
  if (group.polylines.length !== 1) {
    throw new WarpRequestError(`${groupId} must contain exactly one polyline.`);
  }
  const points = group.polylines[0];
  if (points.length < 3) {
    throw new WarpRequestError(`${groupId} must contain at least three points.`);
  }
  if (polygonArea(points) === 0) {
    throw new WarpRequestError(`${groupId} must not be degenerate.`);
  }
  return {
    points: normalizeClosedPolyline(points),
    style: group.style,
  };
}

function parseOpenShapeGroup(groupContent: string | undefined, groupId: string): { shapes: WarpedPolylineShape[]; style: WarpGeometryPresentation } {
  const group = parsePolylineGroup(groupContent, groupId);
  return {
    style: group.style,
    shapes: group.polylines.map((points) => {
    if (points.length < 2) {
      throw new WarpRequestError(`${groupId} polylines must contain at least two points.`);
    }
    return {
      segments: segmentsFromVertices(points, false),
    };
    }),
  };
}

function parsePolylineGroup(groupContent: string | undefined, groupId: string): ParsedPolylineGroup {
  if (groupContent === undefined) {
    if (groupId === WARP_GEOMETRY_GROUPS.outerBoundary || groupId === WARP_GEOMETRY_GROUPS.innerBoundary) {
      throw new WarpRequestError(`${groupId} group is required.`);
    }
    return {
      polylines: [],
      style: defaultPresentation(groupId),
    };
  }

  const disallowedContent = groupContent.replace(/<polyline\b[^>]*\/?>/g, "").trim();
  if (disallowedContent !== "") {
    throw new WarpRequestError(`${groupId} may only contain polyline elements.`);
  }

  const polylines: Point[][] = [];
  let style = defaultPresentation(groupId);
  const polylineExpression = /<polyline\b([^>]*)\/?>/g;
  let match = polylineExpression.exec(groupContent);
  while (match !== null) {
    if (polylines.length === 0) {
      style = parsePresentation(match[1], groupId);
    }
    const pointsValue = attributeValue(match[1], "points");
    if (pointsValue === null) {
      throw new WarpRequestError(`${groupId} polyline is missing points.`);
    }
    polylines.push(parsePoints(pointsValue, groupId));
    match = polylineExpression.exec(groupContent);
  }

  if (polylines.length === 0 && (groupId === WARP_GEOMETRY_GROUPS.outerBoundary || groupId === WARP_GEOMETRY_GROUPS.innerBoundary)) {
    throw new WarpRequestError(`${groupId} must contain at least one polyline.`);
  }

  return {
    polylines,
    style,
  };
}

function parsePoints(pointsValue: string, groupId: string): Point[] {
  const tokens = pointsValue.trim().split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0) {
    throw new WarpRequestError(`${groupId} polyline points must not be empty.`);
  }

  return tokens.map((token) => {
    const coordinates = token.split(",");
    if (coordinates.length !== 2) {
      throw new WarpRequestError(`${groupId} points must use x,y pairs.`);
    }
    const x = Number(coordinates[0]);
    const y = Number(coordinates[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new WarpRequestError(`${groupId} points must be finite numbers.`);
    }
    return { x, y };
  });
}

function normalizeClosedPolyline(points: readonly Point[]): Point[] {
  if (points.length > 1) {
    const firstPoint = points[0];
    const lastPoint = points[points.length - 1];
    if (samePoint(firstPoint, lastPoint)) {
      return points.slice(0, -1);
    }
  }
  return [...points];
}

function samePoint(first: Point, second: Point): boolean {
  return first.x === second.x && first.y === second.y;
}

function polygonArea(points: readonly Point[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area * 0.5;
}

function ensureBoundaryContains(outerShape: PolygonShape, innerBoundary: readonly Point[], groupId: string): void {
  for (const point of innerBoundary) {
    if (!outerShape.containsPoint(point) && outerShape.distance(point) < 0) {
      throw new WarpRequestError(`${groupId} must stay inside the outer boundary.`);
    }
  }
}

function toClosedShape(points: readonly Point[]): WarpedPolylineShape {
  return {
    segments: segmentsFromVertices(points, true),
    closed: true,
  };
}

function parsePresentation(attributes: string, groupId: string): WarpGeometryPresentation {
  const defaults = defaultPresentation(groupId);
  const stroke = nonEmptyAttribute(attributes, "stroke") ?? defaults.stroke;
  const strokeWidth = numericAttribute(attributes, "stroke-width") ?? defaults.strokeWidth;
  const strokeLineCap = nonEmptyAttribute(attributes, "stroke-linecap") ?? defaults.strokeLineCap;
  const strokeLineJoin = nonEmptyAttribute(attributes, "stroke-linejoin") ?? defaults.strokeLineJoin;
  const vectorEffect = nonEmptyAttribute(attributes, "vector-effect") ?? defaults.vectorEffect;
  const opacity = numericAttribute(attributes, "opacity") ?? defaults.opacity;

  const presentation: WarpGeometryPresentation = {
    stroke,
    strokeWidth,
    strokeLineCap,
    strokeLineJoin,
    vectorEffect,
  };
  if (opacity !== undefined) {
    return {
      ...presentation,
      opacity,
    };
  }
  return presentation;
}

function defaultPresentation(groupId: string): WarpGeometryPresentation {
  const defaults = WARP_GEOMETRY_PRESENTATION[groupId];
  const presentation: WarpGeometryPresentation = {
    stroke: defaults.stroke,
    strokeWidth: defaults.strokeWidth,
    strokeLineCap: defaults.strokeLineCap,
    strokeLineJoin: defaults.strokeLineJoin,
    vectorEffect: defaults.vectorEffect,
  };
  if (defaults.opacity !== undefined) {
    return {
      ...presentation,
      opacity: defaults.opacity,
    };
  }
  return presentation;
}

function nonEmptyAttribute(attributes: string, attributeName: string): string | null {
  const value = attributeValue(attributes, attributeName);
  if (value === null || value.trim() === "") {
    return null;
  }
  return value;
}

function numericAttribute(attributes: string, attributeName: string): number | undefined {
  const value = attributeValue(attributes, attributeName);
  if (value === null) {
    return undefined;
  }
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0.0) {
    throw new WarpRequestError(`${attributeName} must be a non-negative finite number.`);
  }
  return numericValue;
}

function attributeValue(attributes: string, attributeName: string): string | null {
  const attributeExpression = new RegExp(`${attributeName}\\s*=\\s*"([^"]*)"`);
  const match = attributeExpression.exec(attributes);
  return match?.[1] ?? null;
}
