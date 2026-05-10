import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { chromium } from "playwright";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(rootDir, "artifacts");
const outputPath = path.join(outputDir, "warped-grid-t0-600.mp4");

const frameRate = 30;
const startHoldSeconds = 1;
const endHoldSeconds = 3;
const startTime = 0;
const endTime = 600;
const viewportWidth = 1600;
const viewportHeight = 1200;

async function main() {
  await mkdir(outputDir, { recursive: true });

  const tempDir = await mkdtemp(path.join(tmpdir(), "gridwarp-video-"));
  const staticServer = await createStaticServer(rootDir);
  try {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: viewportWidth, height: viewportHeight } });
      await page.goto(`${staticServer.origin}/index.html`, { waitUntil: "networkidle" });
      await page.waitForFunction(() => {
        const scene = document.getElementById("scene");
        return scene instanceof SVGSVGElement && scene.childElementCount > 0;
      });
      await configureScene(page);

      const scene = page.locator("#scene");
      let frameIndex = 0;

      frameIndex = await captureHoldFrames(page, scene, tempDir, frameIndex, startTime, startHoldSeconds * frameRate);
      for (let time = startTime; time <= endTime; time += 1) {
        frameIndex = await captureFrame(page, scene, tempDir, frameIndex, time);
      }
      frameIndex = await captureHoldFrames(page, scene, tempDir, frameIndex, endTime, endHoldSeconds * frameRate);

      await browser.close();
      console.log(`\nCaptured ${String(frameIndex)} frames.`);
    } catch (error) {
      await browser.close();
      throw error;
    }

    await encodeVideo(tempDir, outputPath, frameRate);
    console.log(`Wrote ${outputPath}`);
  } finally {
    await staticServer.close();
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function configureScene(page) {
  await page.locator("#grid-enabled").uncheck();
  await page.locator("#diagonals-enabled").check();
}

async function captureHoldFrames(page, scene, tempDir, frameIndex, time, frameCount) {
  let nextFrameIndex = frameIndex;
  for (let frameOffset = 0; frameOffset < frameCount; frameOffset += 1) {
    nextFrameIndex = await captureFrame(page, scene, tempDir, nextFrameIndex, time);
  }
  return nextFrameIndex;
}

async function captureFrame(page, scene, tempDir, frameIndex, time) {
  await setTime(page, time);
  await scene.screenshot({ path: framePath(tempDir, frameIndex), omitBackground: false });
  process.stdout.write(`\rCaptured frame ${String(frameIndex + 1)} at t=${String(time)}`);
  return frameIndex + 1;
}

async function setTime(page, time) {
  const formattedTime = `${time.toFixed(1)}`;
  await page.locator("#time-slider").evaluate(
    (element, value) => {
      if (!(element instanceof HTMLInputElement)) {
        throw new Error("Expected #time-slider to be an input element.");
      }
      element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
    },
    formattedTime,
  );
  await page.waitForFunction(
    (value) => document.getElementById("time-value")?.textContent === value,
    formattedTime,
  );
}

function framePath(tempDir, frameIndex) {
  return path.join(tempDir, `frame-${String(frameIndex).padStart(4, "0")}.png`);
}

async function encodeVideo(tempDir, outputPath, frameRate) {
  console.log("\nEncoding video...");
  await runCommand("ffmpeg", [
    "-y",
    "-framerate",
    String(frameRate),
    "-i",
    path.join(tempDir, "frame-%04d.png"),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "18",
    outputPath,
  ]);
}

async function runCommand(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: rootDir, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${String(code)}.`));
    });
  });
}

async function createStaticServer(baseDir) {
  const server = http.createServer(async (request, response) => {
    try {
      const requestedUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const safePath = normalizeRequestPath(baseDir, requestedUrl.pathname);
      const fileStats = await stat(safePath);
      const filePath = fileStats.isDirectory() ? path.join(safePath, "index.html") : safePath;
      const contentType = mimeTypeForPath(filePath);
      response.writeHead(200, { "Content-Type": contentType });
      createReadStream(filePath).pipe(response);
    } catch (error) {
      const statusCode = isNotFoundError(error) ? 404 : 500;
      const body = statusCode === 404 ? "Not found" : "Internal server error";
      response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(body);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to determine static server address.");
  }

  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    close: async () => {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

function normalizeRequestPath(baseDir, requestPath) {
  const decodedPath = decodeURIComponent(requestPath);
  const normalizedPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const resolvedPath = path.resolve(baseDir, `.${normalizedPath}`);
  const relativePath = path.relative(baseDir, resolvedPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Path escapes the export root.");
  }
  return resolvedPath;
}

function mimeTypeForPath(filePath) {
  const extension = path.extname(filePath);
  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function isNotFoundError(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

await main();