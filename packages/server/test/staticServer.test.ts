import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type ServerHandle, startServer } from "../src/net/wsServer.js";

interface HttpResponse {
  body: string;
  contentType: string | undefined;
  statusCode: number | undefined;
}

function getEphemeralPort(): Promise<number> {
  const probe = createServer();

  return new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        reject(new Error("failed to reserve an ephemeral port"));
        return;
      }

      probe.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

function request(port: number, path: string): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const request = get({ hostname: "127.0.0.1", path, port }, (response) => {
      const chunks: string[] = [];
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => chunks.push(chunk));
      response.on("end", () => {
        const contentType = response.headers["content-type"];
        resolve({
          body: chunks.join(""),
          contentType: Array.isArray(contentType) ? contentType[0] : contentType,
          statusCode: response.statusCode,
        });
      });
    });
    request.once("error", reject);
  });
}

describe("static production serving", () => {
  let port = 0;
  let server: ServerHandle;
  let staticDir = "";

  beforeAll(async () => {
    staticDir = await mkdtemp(join(tmpdir(), "agent-town-static-"));
    await Promise.all([
      writeFile(join(staticDir, "index.html"), "<main>agent town</main>"),
      writeFile(join(staticDir, "app.js"), "export const town = true;"),
      writeFile(join(staticDir, "app.css"), "body { margin: 0; }"),
      writeFile(join(staticDir, "app.js.map"), "{}"),
      writeFile(join(staticDir, "tile.png"), new Uint8Array([137, 80, 78, 71])),
      writeFile(join(staticDir, "icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>'),
    ]);
    port = await getEphemeralPort();
    server = startServer({ port, seed: 42, staticDir });
  });

  afterAll(async () => {
    await server.close();
    await rm(staticDir, { recursive: true });
  });

  it("serves index.html for the root path", async () => {
    const response = await request(port, "/");

    expect(response).toMatchObject({
      body: "<main>agent town</main>",
      contentType: "text/html; charset=utf-8",
      statusCode: 200,
    });
  });

  it.each([
    ["/index.html", "text/html; charset=utf-8"],
    ["/app.js", "text/javascript; charset=utf-8"],
    ["/app.css", "text/css; charset=utf-8"],
    ["/app.js.map", "application/json; charset=utf-8"],
    ["/tile.png", "image/png"],
    ["/icon.svg", "image/svg+xml; charset=utf-8"],
  ])("serves %s with content type %s", async (path, contentType) => {
    const response = await request(port, path);

    expect(response.statusCode).toBe(200);
    expect(response.contentType).toBe(contentType);
  });

  it("returns 404 for a missing file", async () => {
    const response = await request(port, "/missing.js");

    expect(response.statusCode).toBe(404);
  });

  it("rejects path traversal", async () => {
    const response = await request(port, "/../etc/passwd");

    expect(response.statusCode).toBe(404);
  });
});
