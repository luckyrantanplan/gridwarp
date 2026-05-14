import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createInitialGeometry } from "../src/client/initial-geometry.js";
import { createAppServer } from "../src/server/server.js";
import type {
  NoisePreviewResponse,
  NoisePreviewSchemaResponse,
} from "../src/shared/noise-preview.js";
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
    const noiseClientModuleResponse = await fetch(`http://127.0.0.1:${String(address.port)}/src/client/noise-preview.js`);
    const noiseClientModule = await noiseClientModuleResponse.text();
    const sharedModuleResponse = await fetch(`http://127.0.0.1:${String(address.port)}/src/shared/warp-request.js`);
    const sharedModule = await sharedModuleResponse.text();
    const noiseSharedModuleResponse = await fetch(`http://127.0.0.1:${String(address.port)}/src/shared/noise-preview.js`);
    const noiseSharedModule = await noiseSharedModuleResponse.text();
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

    assert.equal(noiseClientModuleResponse.status, 200);
    assert.match(noiseClientModuleResponse.headers.get("content-type") ?? "", /application\/javascript/);
    assert.match(noiseClientModule, /fetch\("\/api\/noise\/schema"/);
    assert.match(noiseClientModule, /fetch\("\/api\/noise\/generate"/);
    assert.doesNotMatch(noiseClientModule, /interface NoisePreviewSchemaResponse/);

    assert.equal(sharedModuleResponse.status, 200);
    assert.match(sharedModuleResponse.headers.get("content-type") ?? "", /application\/javascript/);
    assert.match(sharedModule, /export const WARP_GEOMETRY_FORMAT = "svg-polyline-overlay\/v1";/);
    assert.doesNotMatch(sharedModule, /interface WarpRequest/);

    assert.equal(noiseSharedModuleResponse.status, 200);
    assert.match(noiseSharedModuleResponse.headers.get("content-type") ?? "", /application\/javascript/);
    assert.match(noiseSharedModule, /export class NoisePreviewRequestError extends Error/);
    assert.doesNotMatch(noiseSharedModule, /interface NoisePreviewResponse/);

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

void test("noise preview endpoints return schema and server-generated SVG", async () => {
  const server = createAppServer();
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });

  try {
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${String(address.port)}`;

    const schemaResponse = await fetch(`${baseUrl}/api/noise/schema`);
    const schemaPayload = await schemaResponse.json() as NoisePreviewSchemaResponse;

    const previewResponse = await fetch(`${baseUrl}/api/noise/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        parameters: {
          ...schemaPayload.defaultParameters,
          renderWidth: 320,
          renderHeight: 240,
          showHeatmap: false,
          randomSeed: "gridwarp-noise-test",
        },
      }),
    });
    const previewPayload = await previewResponse.json() as NoisePreviewResponse;

    const invalidPreviewResponse = await fetch(`${baseUrl}/api/noise/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parameters: null }),
    });
    const invalidPreviewMessage = await invalidPreviewResponse.text();

    assert.equal(schemaResponse.status, 200);
    assert.match(schemaResponse.headers.get("content-type") ?? "", /application\/json/);
    assert.equal(schemaPayload.defaultParameters.renderWidth, 960);
    assert.ok(schemaPayload.parameterGroups.length > 0);
    assert.ok(schemaPayload.parameterDefinitions.length > 0);

    assert.equal(previewResponse.status, 200);
    assert.match(previewResponse.headers.get("content-type") ?? "", /application\/json/);
    assert.equal(previewPayload.parameters.renderWidth, 320);
    assert.equal(previewPayload.parameters.renderHeight, 240);
    assert.equal(previewPayload.parameters.showHeatmap, false);
    assert.equal(previewPayload.parameters.randomSeed, "gridwarp-noise-test");
    assert.match(previewPayload.svg, /^<svg/);
    assert.match(previewPayload.svg, /width="320"/);
    assert.match(previewPayload.svg, /height="240"/);
    assert.match(previewPayload.svg, /Generated displacement field/);

    assert.equal(invalidPreviewResponse.status, 400);
    assert.match(invalidPreviewMessage, /parameters object/);
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
      samplesPerUnit: 1.0,
      gain: 0.75,
      plateau: 0.75,
    };

    const response = await fetch(`${baseUrl}/api/warp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    const payload = await response.json() as { svg: string };

    const zeroTimeResponse = await fetch(`${baseUrl}/api/warp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...requestBody,
        time: 0,
      }),
    });
    const zeroTimePayload = await zeroTimeResponse.json() as { svg: string };

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

    const styledGeometrySvg = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">',
      '<g id="outer-boundary"><polyline fill="none" stroke="#102030" stroke-width="4.5" stroke-linecap="square" stroke-linejoin="round" vector-effect="non-scaling-stroke" points="1,1 9,1 9,9 1,9 1,1" /></g>',
      '<g id="inner-boundary"><polyline fill="none" stroke="#203040" stroke-width="1.5" stroke-linecap="butt" stroke-linejoin="miter" vector-effect="non-scaling-stroke" points="4,4 6,4 6,6 4,6 4,4" /></g>',
      '<g id="horizontal-grid"><polyline fill="none" stroke="#ff00aa" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="bevel" vector-effect="non-scaling-stroke" opacity="0.42" points="1,5 9,5" /></g>',
      '</svg>',
    ].join("");

    const styledGeometryResponse = await fetch(`${baseUrl}/api/warp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...requestBody,
        geometry: {
          format: WARP_GEOMETRY_FORMAT,
          svg: styledGeometrySvg,
        },
      }),
    });
    const styledGeometryPayload = await styledGeometryResponse.json() as { svg: string };

    const styledZeroTimeResponse = await fetch(`${baseUrl}/api/warp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...requestBody,
        time: 0,
        geometry: {
          format: WARP_GEOMETRY_FORMAT,
          svg: styledGeometrySvg,
        },
      }),
    });
    const styledZeroTimePayload = await styledZeroTimeResponse.json() as { svg: string };

    const invalidGeometryResponse = await fetch(`${baseUrl}/api/warp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...requestBody,
        geometry: {
          format: WARP_GEOMETRY_FORMAT,
          svg: "<svg viewBox=\"0 0 10 10\"><g id=\"outer-boundary\"><polyline points=\"0,0 1,0 1,1\" /></g></svg>",
        },
      }),
    });
    const invalidGeometryMessage = await invalidGeometryResponse.text();

    const missingViewBoxResponse = await fetch(`${baseUrl}/api/warp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...requestBody,
        geometry: {
          format: WARP_GEOMETRY_FORMAT,
          svg: "<svg><g id=\"outer-boundary\"><polyline points=\"0,0 10,0 10,10 0,10\" /></g><g id=\"inner-boundary\"><polyline points=\"1,1 2,1 2,2 1,2\" /></g></svg>",
        },
      }),
    });
    const missingViewBoxMessage = await missingViewBoxResponse.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    assert.match(payload.svg, /^<svg/);
    assert.match(payload.svg, /width="640"/);
    assert.match(payload.svg, /height="480"/);
    assert.match(payload.svg, /data-caption="/);
    assert.ok(countSvgTag(payload.svg, "path") > countSvgTag(noGridPayload.svg, "path"));
    assert.ok(countSvgTag(payload.svg, "path") > countSvgTag(noDiagonalPayload.svg, "path"));
    assert.equal(zeroTimeResponse.status, 200);
    assert.ok(!zeroTimePayload.svg.includes(" C "));
    assert.equal(styledGeometryResponse.status, 200);
    assert.equal(styledZeroTimeResponse.status, 200);
    assert.match(styledGeometryPayload.svg, /stroke="#ff00aa"/);
    assert.match(styledGeometryPayload.svg, /stroke-width="7\.5"/);
    assert.match(styledGeometryPayload.svg, /stroke-linecap="round"/);
    assert.match(styledGeometryPayload.svg, /stroke-linejoin="bevel"/);
    assert.match(styledGeometryPayload.svg, /opacity="0\.42"/);
    assert.match(styledGeometryPayload.svg, /stroke="#102030"/);
    assert.match(styledGeometryPayload.svg, /stroke-width="4\.5"/);
    assert.match(styledGeometryPayload.svg, /stroke-linecap="square"/);
    assert.match(styledGeometryPayload.svg, /stroke-linejoin="round"/);
    assert.match(styledZeroTimePayload.svg, /stroke="#ff00aa"/);
    assert.match(styledZeroTimePayload.svg, /stroke-width="7\.5"/);
    assert.match(styledZeroTimePayload.svg, /stroke-linecap="round"/);
    assert.match(styledZeroTimePayload.svg, /stroke-linejoin="bevel"/);
    assert.match(styledZeroTimePayload.svg, /opacity="0\.42"/);
    assert.match(styledZeroTimePayload.svg, /stroke="#102030"/);
    assert.match(styledZeroTimePayload.svg, /stroke-width="4\.5"/);
    assert.match(styledZeroTimePayload.svg, /stroke-linecap="square"/);
    assert.match(styledZeroTimePayload.svg, /stroke-linejoin="round"/);

    assert.equal(noGridResponse.status, 200);
    assert.equal(noDiagonalResponse.status, 200);
    assert.equal(invalidGeometryResponse.status, 400);
    assert.match(invalidGeometryMessage, /inner-boundary group is required/);
    assert.equal(missingViewBoxResponse.status, 400);
    assert.match(missingViewBoxMessage, /viewBox/);
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