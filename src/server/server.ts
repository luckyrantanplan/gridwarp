import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseGeometrySvg } from "./parse-geometry-svg.js";
import { renderWarpScene } from "./render-warp-scene.js";
import { parseWarpRequest, WarpRequestError, type WarpResponse } from "../shared/warp-request.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);
const projectRoot = path.resolve(currentDirectory, "../..");
const sourceRoot = path.join(projectRoot, "src");

export function createAppServer(): Server {
  return createServer((request, response) => {
    void routeRequest(request, response);
  });
}

async function routeRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.url === undefined) {
    sendText(response, 400, "Missing request URL");
    return;
  }

  const requestUrl = new URL(request.url, "http://localhost");
  if (requestUrl.pathname === "/api/warp") {
    await handleWarpRoute(request, response);
    return;
  }

  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    response.writeHead(405, {
      Allow: "GET, HEAD, POST",
      "content-type": "text/plain; charset=utf-8",
    });
    response.end(method === "HEAD" ? undefined : "Method not allowed");
    return;
  }

  if (requestUrl.pathname === "/") {
    await serveFile(path.join(projectRoot, "index.html"), "text/html; charset=utf-8", response, method === "HEAD");
    return;
  }

  if (requestUrl.pathname.startsWith("/src/") && requestUrl.pathname.endsWith(".js")) {
    const relativePath = requestUrl.pathname.slice(1);
    await serveBrowserModule(relativePath, response, method === "HEAD");
    return;
  }

  if (requestUrl.pathname.startsWith("/src/")) {
    sendText(response, 404, "Not found");
    return;
  }

  await serveProjectAsset(requestUrl.pathname, response, method === "HEAD");
}

async function handleWarpRoute(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== "POST") {
    response.writeHead(405, {
      Allow: "POST",
      "content-type": "text/plain; charset=utf-8",
    });
    response.end("Method not allowed");
    return;
  }

  try {
    const body = await readRequestBody(request);
    const warpRequest = parseWarpRequest(body);
    const payload: WarpResponse = { svg: renderWarpScene(warpRequest, parseGeometrySvg(warpRequest.geometry)) };
    sendJson(response, 200, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown warp error";
    const status = error instanceof WarpRequestError ? 400 : 500;
    sendText(response, status, message);
  }
}

async function serveBrowserModule(relativePath: string, response: ServerResponse, headOnly: boolean): Promise<void> {
  const relativeSourcePath = relativePath.slice("src/".length).replace(/\.js$/, ".ts");
  const sourceFilePath = path.resolve(sourceRoot, relativeSourcePath);
  const sourceRootPrefix = `${sourceRoot}${path.sep}`;

  if (sourceFilePath !== sourceRoot && !sourceFilePath.startsWith(sourceRootPrefix)) {
    sendText(response, 404, "Not found");
    return;
  }

  try {
    const fileStat = await stat(sourceFilePath);
    if (!fileStat.isFile()) {
      sendText(response, 404, "Not found");
      return;
    }
  } catch {
    sendText(response, 404, "Not found");
    return;
  }

  try {
    const source = await readFile(sourceFilePath, "utf-8");
    const output = stripTypeScriptTypes(source, {
      mode: "strip",
      sourceUrl: pathToFileURL(sourceFilePath).href,
    });
    response.writeHead(200, {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(headOnly ? undefined : output);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown module transform error";
    sendText(response, 500, message);
  }
}

async function serveProjectAsset(requestPath: string, response: ServerResponse, headOnly: boolean): Promise<void> {
  const decodedPath = decodeURIComponent(requestPath);
  const normalizedPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const assetPath = path.resolve(projectRoot, `.${normalizedPath}`);
  const relativePath = path.relative(projectRoot, assetPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    sendText(response, 404, "Not found");
    return;
  }

  try {
    const fileStat = await stat(assetPath);
    if (!fileStat.isFile()) {
      sendText(response, 404, "Not found");
      return;
    }
  } catch {
    sendText(response, 404, "Not found");
    return;
  }

  await serveFile(assetPath, mimeTypeForPath(assetPath), response, headOnly);
}

async function serveFile(filePath: string, contentType: string, response: ServerResponse, headOnly: boolean): Promise<void> {
  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "content-type": contentType,
      "cache-control": "no-store",
    });
    response.end(headOnly ? undefined : content);
  } catch {
    sendText(response, 404, "Not found");
  }
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = toBuffer(chunk);
    totalBytes += buffer.length;
    if (totalBytes > 1024 * 1024) {
      throw new WarpRequestError("Request body must be 1 MiB or smaller.");
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf-8");
}

function toBuffer(chunk: unknown): Buffer {
  if (typeof chunk === "string") {
    return Buffer.from(chunk, "utf-8");
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk);
  }
  throw new WarpRequestError("Request body must contain text data.");
}

function sendJson(response: ServerResponse, statusCode: number, payload: WarpResponse): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function sendText(response: ServerResponse, statusCode: number, message: string): void {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
  });
  response.end(message);
}

function mimeTypeForPath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".gif":
      return "image/gif";
    case ".html":
      return "text/html; charset=utf-8";
    case ".ico":
      return "image/x-icon";
    case ".jpeg":
    case ".jpg":
      return "image/jpeg";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml; charset=utf-8";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function isMainModule(): boolean {
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const port = Number(process.env.PORT ?? "4173");
  const server = createAppServer();
  server.listen(port, () => {
    console.log(`Gridwarp server listening on http://127.0.0.1:${String(port)}`);
  });
}