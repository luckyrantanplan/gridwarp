import { readFile, stat } from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PORT = 4173;
const HOST = "127.0.0.1";
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

class PathEscapeError extends Error {}

async function main(): Promise<void> {
  const port = resolvePort(process.env.PORT);
  const server = http.createServer((request, response) => {
    void handleRequest(request, response);
  });

  await listen(server, port);
  console.log(`Serving ${rootDir} at http://${HOST}:${String(port)}/`);

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    server.close((error) => {
      if (error) {
        console.error(error);
        process.exitCode = 1;
      }
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    response.writeHead(405, {
      Allow: "GET, HEAD",
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end(method === "HEAD" ? undefined : "Method not allowed");
    return;
  }

  try {
    const requestUrl = new URL(request.url ?? "/", `http://${HOST}`);
    const filePath = await resolveFilePath(rootDir, requestUrl.pathname);
    const contentType = mimeTypeForPath(filePath);
    const body = method === "HEAD" ? undefined : await readFile(filePath);
    response.writeHead(200, { "Content-Type": contentType });
    response.end(body);
  } catch (error) {
    respondWithError(response, method, error);
  }
}

async function resolveFilePath(baseDir: string, requestPath: string): Promise<string> {
  const decodedPath = decodeURIComponent(requestPath);
  const normalizedPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const resolvedPath = path.resolve(baseDir, `.${normalizedPath}`);
  const relativePath = path.relative(baseDir, resolvedPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new PathEscapeError("Request path escapes the static root.");
  }

  const fileStats = await stat(resolvedPath);
  if (!fileStats.isDirectory()) {
    return resolvedPath;
  }

  const indexPath = path.join(resolvedPath, "index.html");
  await stat(indexPath);
  return indexPath;
}

function respondWithError(response: ServerResponse, method: string, error: unknown): void {
  if (error instanceof PathEscapeError) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(method === "HEAD" ? undefined : "Forbidden");
    return;
  }

  if (isNotFoundError(error)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(method === "HEAD" ? undefined : "Not found");
    return;
  }

  console.error(error);
  response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(method === "HEAD" ? undefined : "Internal server error");
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && (error as NodeJS.ErrnoException).code !== undefined
    && ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "");
}

function mimeTypeForPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
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
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function resolvePort(rawPort: string | undefined): number {
  if (rawPort === undefined) {
    return DEFAULT_PORT;
  }

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("PORT must be an integer between 0 and 65535.");
  }
  return port;
}

async function listen(server: http.Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

await main();