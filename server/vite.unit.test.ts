import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HASHED_ASSET, serveStatic } from "./vite";

let dist: string;

beforeAll(async () => {
  dist = await mkdtemp(path.join(os.tmpdir(), "pokerpal-dist-"));
  await mkdir(path.join(dist, "assets"));
  await writeFile(path.join(dist, "index.html"), "<!doctype html><title>LovePoker.club</title>");
  await writeFile(path.join(dist, "assets", "index-Bx3k9aQ2.js"), "console.log('app')");
  await writeFile(path.join(dist, "assets", "icon.png"), "png");
  await writeFile(path.join(dist, "favicon.png"), "png");
});

afterAll(() => rm(dist, { recursive: true, force: true }));

const client = () => {
  const app = express();
  serveStatic(app, dist);
  return request(app);
};

describe("serveStatic (the production client)", () => {
  it("caches hashed build assets for a year (CC-11)", async () => {
    const response = await client().get("/assets/index-Bx3k9aQ2.js");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("revalidates the unhashed files copied from client/public/assets, so a replaced icon shows at once (P2-PROD-04)", async () => {
    const response = await client().get("/assets/icon.png");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-cache");
  });

  it("tells hashed build names from unhashed ones", () => {
    for (const name of ["index-Bb286EZq.js", "index-xsHZnO18.css", "vendor-a1B2c3_e.woff2"]) expect(HASHED_ASSET.test(name), name).toBe(true);
    for (const name of ["icon.png", "logo.png", "club-logo.png", "index.js", "spade-overlays.png"]) {
      expect(HASHED_ASSET.test(name), name).toBe(false);
    }
  });

  it("answers a missing asset with 404, never index.html", async () => {
    const response = await client().get("/assets/index-OldHash.js");

    expect(response.status).toBe(404);
    expect(response.text).not.toContain("LovePoker.club");
  });

  it("serves index.html, at / and for every client route, for revalidation on each load", async () => {
    for (const url of ["/", "/index.html", "/clubs/abc/settings"]) {
      const response = await client().get(url);

      expect(response.status, url).toBe(200);
      expect(response.text, url).toContain("LovePoker.club");
      expect(response.headers["cache-control"], url).toBe("no-cache");
    }
  });

  it("leaves other public files on the default caching", async () => {
    const response = await client().get("/favicon.png");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("public, max-age=0");
  });
});
