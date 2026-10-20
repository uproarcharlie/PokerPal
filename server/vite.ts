import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { type Server } from "http";

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  // Dynamic imports to avoid loading Vite in production
  const { createServer: createViteServer } = await import("vite");
  const viteConfig = (await import("../vite.config.js")).default;
  const { nanoid } = await import("nanoid");

  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    // Vite's own logger: a client compile error is shown in the browser's overlay and the terminal, and
    // the dev server keeps running until the file is fixed.
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

/** index.html is revalidated on every load, so a deploy is picked up at once (CC-11). */
const NO_CACHE = "no-cache";

/**
 * A Vite build file: its name ends in an 8-character hash of its contents ("index-Bb286EZq.js").
 * Files copied as they are from client/public/assets (icon.png, logo.png) have none, so they could be
 * replaced under the same name. A hash with no capital or digit is taken for a word, which only costs
 * a revalidation.
 */
export const HASHED_ASSET = /-(?=[^.]*[A-Z0-9])[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/;

const YEAR_IMMUTABLE = "public, max-age=31536000, immutable";

/**
 * Serves the built client (dist/public). Vite names its build files under assets/ after a hash of
 * their contents, so those are cached for a year and never revalidated; the unhashed files beside
 * them are revalidated on every load, so a replaced icon shows at once. A missing asset is a 404
 * rather than index.html, so a tab left open across a deploy fails plainly instead of being handed
 * HTML as its script. Everything else falls through to index.html (the client routes), which is
 * never cached stale.
 */
export function serveStatic(app: Express, distPath = path.resolve(import.meta.dirname, "public")) {
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(
    "/assets",
    express.static(path.join(distPath, "assets"), {
      index: false,
      fallthrough: false,
      cacheControl: false,
      setHeaders: (res, file) => res.setHeader("Cache-Control", HASHED_ASSET.test(path.basename(file)) ? YEAR_IMMUTABLE : NO_CACHE),
    }),
  );
  app.use(
    express.static(distPath, {
      setHeaders: (res, file) => {
        if (path.basename(file) === "index.html") res.setHeader("Cache-Control", NO_CACHE);
      },
    }),
  );

  // Any other path is a client route.
  app.use("*", (_req, res) => {
    res.setHeader("Cache-Control", NO_CACHE);
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
