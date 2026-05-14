import { segmentsFromVertices, type WarpedPolylineShape } from "../render/polyline-overlay.js";
import { PolygonShape } from "../lib/polygon-shape.js";
import {
  WARP_GEOMETRY_GROUPS,
  type WarpGeometry,
  WarpRequestError,
} from "../shared/warp-request.js";

interface Point {
  readonly x: number;
  readonly y: number;
}

export interface ParsedWarpGeometry {
  readonly outerBoundary: readonly Point[];
  readonly horizontalGrid: readonly WarpedPolylineShape[];
  readonly verticalGrid: readonly WarpedPolylineShape[];
  readonly innerBoundary: readonly WarpedPolylineShape[];
  readonly diagonals: readonly WarpedPolylineShape[];
}

export function parseGeometrySvg(geometry: WarpGeometry): ParsedWarpGeometry {
  const svgExpression = /^\s*<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/;
  const svgMatch = svgExpression.exec(geometry.svg);
  if (!svgMatch) {
    throw new WarpRequestError("geometry.svg must contain a single svg root element.");
  }

  const groups = extractGroups(svgMatch[1]);
  const outerBoundary = parseClosedBoundary(groups.get(WARP_GEOMETRY_GROUPS.outerBoundary), WARP_GEOMETRY_GROUPS.outerBoundary);
  const innerBoundary = parseClosedBoundary(groups.get(WARP_GEOMETRY_GROUPS.innerBoundary), WARP_GEOMETRY_GROUPS.innerBoundary);
  const outerShape = new PolygonShape(outerBoundary);
  ensureBoundaryContains(outerShape, innerBoundary, WARP_GEOMETRY_GROUPS.innerBoundary);

  return {
    outerBoundary,
    horizontalGrid: parseOpenShapes(groups.get(WARP_GEOMETRY_GROUPS.horizontalGrid), WARP_GEOMETRY_GROUPS.horizontalGrid),
    verticalGrid: parseOpenShapes(groups.get(WARP_GEOMETRY_GROUPS.verticalGrid), WARP_GEOMETRY_GROUPS.verticalGrid),
    innerBoundary: [toClosedShape(innerBoundary)],
    diagonals: parseOpenShapes(groups.get(WARP_GEOMETRY_GROUPS.diagonals), WARP_GEOMETRY_GROUPS.diagonals),
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

function parseClosedBoundary(groupContent: string | undefined, groupId: string): Point[] {
  const polylines = parsePolylinePoints(groupContent, groupId);
  if (polylines.length !== 1) {
    throw new WarpRequestError(`${groupId} must contain exactly one polyline.`);
  }
  const points = polylines[0];
  if (points.length < 3) {
    throw new WarpRequestError(`${groupId} must contain at least three points.`);
  }
  if (polygonArea(points) === 0) {
    throw new WarpRequestError(`${groupId} must not be degenerate.`);
  }
  return normalizeClosedPolyline(points);
}

function parseOpenShapes(groupContent: string | undefined, groupId: string): WarpedPolylineShape[] {
  if (groupContent === undefined) {
    return [];
  }
  const polylines = parsePolylinePoints(groupContent, groupId);
  return polylines.map((points) => {
    if (points.length < 2) {
      throw new WarpRequestError(`${groupId} polylines must contain at least two points.`);
    }
    return {
      segments: segmentsFromVertices(points, false),
    };
  });
}

function parsePolylinePoints(groupContent: string | undefined, groupId: string): Point[][] {
  if (groupContent === undefined) {
    if (groupId === WARP_GEOMETRY_GROUPS.outerBoundary || groupId === WARP_GEOMETRY_GROUPS.innerBoundary) {
      throw new WarpRequestError(`${groupId} group is required.`);
    }
    return [];
  }

  const disallowedContent = groupContent.replace(/<polyline\b[^>]*\/?>/g, "").trim();
  if (disallowedContent !== "") {
    throw new WarpRequestError(`${groupId} may only contain polyline elements.`);
  }

  const polylines: Point[][] = [];
  const polylineExpression = /<polyline\b([^>]*)\/?>/g;
  let match = polylineExpression.exec(groupContent);
  while (match !== null) {
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

  return polylines;
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

function attributeValue(attributes: string, attributeName: string): string | null {
  const attributeExpression = new RegExp(`${attributeName}\\s*=\\s*"([^"]*)"`);
  const match = attributeExpression.exec(attributes);
  return match?.[1] ?? null;
}
