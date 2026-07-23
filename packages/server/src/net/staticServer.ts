import { readFile } from "node:fs/promises";
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
};

function sendNotFound(response: ServerResponse): void {
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("見つかりません");
}

function requestPath(request: IncomingMessage): string | undefined {
  if (request.method !== "GET" || request.url === undefined) return undefined;
  const rawPath = request.url.split("?", 1)[0];

  try {
    const decoded = decodeURIComponent(rawPath ?? "");
    return decoded === "/" ? "/index.html" : decoded;
  } catch (error) {
    if (error instanceof URIError) return undefined;
    throw error;
  }
}

function filePathWithin(staticDir: string, path: string): string | undefined {
  const filePath = resolve(staticDir, `.${path}`);
  const relativePath = relative(staticDir, filePath);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    return undefined;
  }
  return filePath;
}

function isMissingFile(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false;
  return error.code === "ENOENT" || error.code === "EISDIR" || error.code === "ENOTDIR";
}

async function serveFile(
  request: IncomingMessage,
  response: ServerResponse,
  staticDir: string,
): Promise<void> {
  const path = requestPath(request);
  const filePath = path === undefined ? undefined : filePathWithin(staticDir, path);
  const contentType = filePath === undefined ? undefined : CONTENT_TYPES[extname(filePath)];
  if (filePath === undefined || contentType === undefined) {
    sendNotFound(response);
    return;
  }

  try {
    const contents = await readFile(filePath);
    response.writeHead(200, { "Content-Type": contentType });
    response.end(contents);
  } catch (error) {
    if (isMissingFile(error)) {
      sendNotFound(response);
      return;
    }
    console.error("static file read failed", error);
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("サーバー内部エラー");
  }
}

export function createStaticHandler(staticDir?: string): RequestListener {
  const resolvedStaticDir = staticDir === undefined ? undefined : resolve(staticDir);

  return (request, response) => {
    if (resolvedStaticDir === undefined) {
      sendNotFound(response);
      return;
    }
    void serveFile(request, response, resolvedStaticDir);
  };
}
