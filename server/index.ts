import "dotenv/config";
import http from "http";
import type { Duplex } from "stream";
import { createApp } from "./app";
import { createPgSessionStore } from "./config/auth";
import { loadEnv, setEnv } from "./config/env";
import { closePool, getPool } from "./db";
import { runBootMigrations } from "./db/migrate";
import { log, serveStatic, setupVite } from "./vite";

const SHUTDOWN_GRACE_MS = 10_000;

async function main(): Promise<void> {
  const env = loadEnv(process.env);
  setEnv(env);

  await runBootMigrations(env);

  const sessionStore = createPgSessionStore(getPool());
  const app = await createApp({ env, sessionStore });
  const server = http.createServer(app);

  const upgradedSockets = new Set<Duplex>();
  // Vite goes last so its catch-all never shadows the API routes.
  if (env.NODE_ENV === "development") {
    // Vite's HMR websocket never goes idle, so shutdown closes it explicitly. Only here: with any
    // "upgrade" listener, Node hands every request carrying an Upgrade header to the listeners
    // instead of Express, and production has no websockets to answer them.
    server.on("upgrade", (_req, socket: Duplex) => {
      upgradedSockets.add(socket);
      socket.once("close", () => upgradedSockets.delete(socket));
    });
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Railway routes traffic to $PORT; bind all interfaces so it can reach us.
  server.listen({ port: env.PORT, host: "0.0.0.0" }, () => {
    log(`serving on port ${env.PORT}`);
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal} received, shutting down`);

    const forceExit = setTimeout(() => {
      console.error(`Connections still open after ${SHUTDOWN_GRACE_MS}ms; exiting anyway`);
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    forceExit.unref();

    // Stop accepting connections, let in-flight requests finish, then release the DB.
    server.close((closeError) => {
      sessionStore.close();
      closePool().then(
        () => process.exit(closeError ? 1 : 0),
        (error) => {
          console.error("Error while closing the database pool:", error);
          process.exit(1);
        },
      );
    });
    server.closeIdleConnections();
    upgradedSockets.forEach((socket) => socket.destroy());
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

main().catch((error) => {
  console.error("Server failed to start:", error);
  process.exit(1);
});
