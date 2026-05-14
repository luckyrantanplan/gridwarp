import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createInitialGeometry } from "../src/client/initial-geometry.js";
import { createAppServer } from "../src/server/server.js";
import { WARP_GEOMETRY_FORMAT, type WarpRequest } from "../src/shared/warp-request.js";

void test("html and browser module routes are served from source", async () => {
  const server = createAppServer();
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });

  try {
    const address = server.address() as AddressInfo;
    const htmlResponse = await fetch(`http://127.0.0.1:${String(address.port)}/`);
    const html = await htmlResponse.text();
    const clientModuleResponse = await fetch(`http://127.0.0.1:${String(address.port)}/src/client/index.js`);
    const clientModule = await clientModuleResponse.text();
    const sharedModuleResponse = await fetch(`http://127.0.0.1:${String(address.port)}/src/shared/warp-request.js`);
    const sharedModule = await sharedModuleResponse.text();
    const missingModuleResponse = await fetch(`http://127.0.0.1:${String(address.port)}/src/client/missing.js`);
    const traversalResponse = await fetch(`http://127.0.0.1:${String(address.port)}/src/%2e%2e/package.js`);

    assert.equal(htmlResponse.status, 200);
    assert.match(htmlResponse.headers.get("content-type") ?? "", /text\/html/);
    assert.match(html, /<script type="module" src="\/src\/client\/index\.js">\s*<\/script>/);

    assert.equal(clientModuleResponse.status, 200);
    assert.match(clientModuleResponse.headers.get("content-type") ?? "", /application\/javascript/);
    assert.match(clientModule, /fetch\("\/api\/warp"/);
    assert.match(clientModule, /caption\.textContent = parsedScene\.getAttribute\("data-caption"\)/);
    assert.doesNotMatch(clientModule, /interface SceneViewport/);
    assert.doesNotMatch(clientModule, /type WarpResponse/);
    assert.doesNotMatch(clientModule, /AngleDirectedSurfaceWarpField/);

    assert.equal(sharedModuleResponse.status, 200);
    assert.match(sharedModuleResponse.headers.get("content-type") ?? "", /application\/javascript/);
    assert.match(sharedModule, /export const WARP_GEOMETRY_FORMAT = "svg-polyline-overlay\/v1";/);
    assert.doesNotMatch(sharedModule, /interface WarpRequest/);

    assert.equal(missingModuleResponse.status, 404);
    assert.equal(traversalResponse.status, 404);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
});

void test("POST /api/warp returns computed SVG and rejects invalid requests", async () => {
  const server = createAppServer();
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });

  try {
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${String(address.port)}`;
    const requestBody: WarpRequest = {
      geometry: createInitialGeometry(640, 480, true, true),
      renderWidth: 640,
      renderHeight: 480,
      time: 16,
      sampleGridSize: 64,
      gain: 0.75,
      plateau: 0.75,
    };

    const response = await fetch(`${baseUrl}/api/warp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    const payload = await response.json() as { svg: string };

    const noGridResponse = await fetch(`${baseUrl}/api/warp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...requestBody,
        geometry: createInitialGeometry(640, 480, false, true),
      }),
    });
    const noGridPayload = await noGridResponse.json() as { svg: string };

    const noDiagonalResponse = await fetch(`${baseUrl}/api/warp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...requestBody,
        geometry: createInitialGeometry(640, 480, true, false),
      }),
    });
    const noDiagonalPayload = await noDiagonalResponse.json() as { svg: string };

    const invalidGeometryResponse = await fetch(`${baseUrl}/api/warp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...requestBody,
        geometry: {
          format: WARP_GEOMETRY_FORMAT,
          svg: "<svg><g id=\"outer-boundary\"><polyline points=\"0,0 1,0 1,1\" /></g></svg>",
        },
      }),
    });
    const invalidGeometryMessage = await invalidGeometryResponse.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    assert.match(payload.svg, /^<svg/);
    assert.match(payload.svg, /width="640"/);
    assert.match(payload.svg, /height="480"/);
    assert.match(payload.svg, /data-caption="/);
    assert.ok(countSvgTag(payload.svg, "path") > countSvgTag(noGridPayload.svg, "path"));
    assert.ok(countSvgTag(payload.svg, "path") > countSvgTag(noDiagonalPayload.svg, "path"));

    assert.equal(noGridResponse.status, 200);
    assert.equal(noDiagonalResponse.status, 200);
    assert.equal(invalidGeometryResponse.status, 400);
    assert.match(invalidGeometryMessage, /inner-boundary group is required/);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
});

function countSvgTag(svg: string, tagName: string): number {
  const matches = svg.match(new RegExp(`<${tagName}(\\s|>)`, "g"));
  return matches?.length ?? 0;
}