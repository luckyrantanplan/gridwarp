/**
 * Adaptive viewport subdivision for contour extraction.
 */
import type { Axis, Cell, ScreenNode, WarpField } from "./types.js";

/**
 * Stores the geometric thresholds that control adaptive cell refinement.
 */
export class LeafCellCollectorSettings {
  constructor(
    readonly maxContourCellSize: number,
    readonly minContourCellSize: number,
    readonly maxAdaptiveDepth: number,
    readonly curvatureErrorThreshold: number,
  ) {}
}

/**
 * Builds the leaf-cell set used by marching squares and seed generation.
 */
export class LeafCellCollector {
  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly warp: WarpField,
    private readonly settings: LeafCellCollectorSettings,
  ) {}

  collect(): Cell[] {
    const xCoords = coordinateAxis(this.width, this.settings.maxContourCellSize);
    const yCoords = coordinateAxis(this.height, this.settings.maxContourCellSize);
    const rows = yCoords.length - 1;
    const cols = xCoords.length - 1;

    const baseNodes: ScreenNode[][] = [];
    for (let row = 0; row <= rows; row += 1) {
      const nodeRow: ScreenNode[] = [];
      for (let col = 0; col <= cols; col += 1) {
        nodeRow.push(sampleNode(this.warp, xCoords[col], yCoords[row]));
      }
      baseNodes.push(nodeRow);
    }

    const leafCells: Cell[] = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        this.refineCell(
          leafCells,
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

  private refineCell(
    leafCells: Cell[],
    tl: ScreenNode,
    tr: ScreenNode,
    br: ScreenNode,
    bl: ScreenNode,
    depth: number,
  ): void {
    const cellWidth = tr.screenX - tl.screenX;
    const cellHeight = bl.screenY - tl.screenY;

    if (
      depth >= this.settings.maxAdaptiveDepth
      || Math.max(cellWidth, cellHeight) * 0.5 < this.settings.minContourCellSize
    ) {
      leafCells.push({ tl, tr, br, bl });
      return;
    }

    const midX = 0.5 * (tl.screenX + tr.screenX);
    const midY = 0.5 * (tl.screenY + bl.screenY);
    const topMid = sampleNode(this.warp, midX, tl.screenY);
    const rightMid = sampleNode(this.warp, tr.screenX, midY);
    const bottomMid = sampleNode(this.warp, midX, bl.screenY);
    const leftMid = sampleNode(this.warp, tl.screenX, midY);
    const center = sampleNode(this.warp, midX, midY);

    const curvature = Math.max(
      axisCurvatureError(tl, tr, br, bl, topMid, rightMid, bottomMid, leftMid, center, "warpedX"),
      axisCurvatureError(tl, tr, br, bl, topMid, rightMid, bottomMid, leftMid, center, "warpedY"),
    );

    if (curvature <= this.settings.curvatureErrorThreshold) {
      leafCells.push({ tl, tr, br, bl });
      return;
    }

    this.refineCell(leafCells, tl, topMid, center, leftMid, depth + 1);
    this.refineCell(leafCells, topMid, tr, rightMid, center, depth + 1);
    this.refineCell(leafCells, center, rightMid, br, bottomMid, depth + 1);
    this.refineCell(leafCells, leftMid, center, bottomMid, bl, depth + 1);
  }
}

function coordinateAxis(length: number, cellSize: number): number[] {
  const steps = Math.max(2, Math.ceil(length / cellSize));
  const coordinates: number[] = [];
  for (let index = 0; index <= steps; index += 1) {
    coordinates.push(length * index / steps);
  }
  return coordinates;
}

function sampleNode(warp: WarpField, x: number, y: number): ScreenNode {
  const value = warp.valueAt(x, y);
  return { screenX: x, screenY: y, warpedX: value.warpedX, warpedY: value.warpedY };
}

function axisCurvatureError(
  topLeft: ScreenNode,
  topRight: ScreenNode,
  bottomRight: ScreenNode,
  bottomLeft: ScreenNode,
  topMid: ScreenNode,
  rightMid: ScreenNode,
  bottomMid: ScreenNode,
  leftMid: ScreenNode,
  center: ScreenNode,
  axis: Axis,
): number {
  return Math.max(
    Math.abs(center[axis] - 0.25 * (topLeft[axis] + topRight[axis] + bottomRight[axis] + bottomLeft[axis])),
    Math.abs(topMid[axis] - 0.5 * (topLeft[axis] + topRight[axis])),
    Math.abs(rightMid[axis] - 0.5 * (topRight[axis] + bottomRight[axis])),
    Math.abs(bottomMid[axis] - 0.5 * (bottomLeft[axis] + bottomRight[axis])),
    Math.abs(leftMid[axis] - 0.5 * (topLeft[axis] + bottomLeft[axis])),
  );
}