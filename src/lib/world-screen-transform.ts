import { makePoint2, type Point2 } from "./polygon-geometry.js";
import type { BoundingBox } from "./polygon-shape.js";

export interface WorldScreenTransform {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly renderWidth: number;
  readonly renderHeight: number;
  readonly worldBounds: BoundingBox;
}

export function createWorldScreenTransform(
  renderWidth: number,
  renderHeight: number,
  worldBounds: BoundingBox,
): WorldScreenTransform {
  const worldWidth = worldBounds.maxX - worldBounds.minX;
  const worldHeight = worldBounds.maxY - worldBounds.minY;
  const safeRenderWidth = renderWidth > 0 ? renderWidth : 1;
  const safeRenderHeight = renderHeight > 0 ? renderHeight : 1;
  const scaleX = worldWidth > 0 ? safeRenderWidth / worldWidth : 1;
  const scaleY = worldHeight > 0 ? safeRenderHeight / worldHeight : 1;
  const scale = Math.min(scaleX, scaleY);
  const contentWidth = worldWidth * scale;
  const contentHeight = worldHeight * scale;

  return {
    scale,
    offsetX: 0.5 * (safeRenderWidth - contentWidth),
    offsetY: 0.5 * (safeRenderHeight - contentHeight),
    renderWidth: safeRenderWidth,
    renderHeight: safeRenderHeight,
    worldBounds,
  };
}

export function screenPointFromWorld(
  point: Point2,
  transform: WorldScreenTransform,
): Point2 {
  return makePoint2(
    transform.offsetX + (point.x - transform.worldBounds.minX) * transform.scale,
    transform.offsetY + (transform.worldBounds.maxY - point.y) * transform.scale,
  );
}

export function worldPointFromScreen(
  screenX: number,
  screenY: number,
  transform: WorldScreenTransform,
): Point2 {
  const safeScale = transform.scale > 0 ? transform.scale : 1;
  return makePoint2(
    transform.worldBounds.minX + (screenX - transform.offsetX) / safeScale,
    transform.worldBounds.maxY - (screenY - transform.offsetY) / safeScale,
  );
}