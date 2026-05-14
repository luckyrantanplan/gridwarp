/**
 * Grid-bucket spatial index used to deduplicate seeds and traced samples.
 */
import type { Point } from "./types.js";

/**
 * Groups nearby points into coarse buckets for fast proximity checks.
 */
export class PointBucketIndex {
  private readonly buckets = new Map<string, Point[]>();
  private readonly bucketSize: number;

  constructor(bucketSize: number) {
    this.bucketSize = bucketSize;
  }

  hasNearby(point: Point, maxDistance: number): boolean {
    const bucket = this.baseBucket(point);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const entries = this.buckets.get(this.bucketKey(bucket.x + dx, bucket.y + dy));
        if (!entries) continue;
        for (const otherPoint of entries) {
          if (distance(point, otherPoint) <= maxDistance) return true;
        }
      }
    }
    return false;
  }

  addPoint(point: Point): void {
    const bucket = this.baseBucket(point);
    const key = this.bucketKey(bucket.x, bucket.y);
    const list = this.buckets.get(key);
    if (list) {
      list.push({ x: point.x, y: point.y });
      return;
    }
    this.buckets.set(key, [{ x: point.x, y: point.y }]);
  }

  private baseBucket(point: Point): Point {
    return { x: Math.floor(point.x / this.bucketSize), y: Math.floor(point.y / this.bucketSize) };
  }

  private bucketKey(xBucket: number, yBucket: number): string {
    return `${String(xBucket)},${String(yBucket)}`;
  }
}

function distance(pointA: Point, pointB: Point): number {
  return Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y);
}