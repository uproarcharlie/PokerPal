/**
 * The container setup. The image runs as the unprivileged `node` user, which
 * can write the uploads/ directory baked into the image; a host directory
 * mounted over it keeps the host's owner, so a compose file that mounts one
 * must run the app as root, as every container did before the image switched
 * users, or local-disk uploads fail with EACCES. Only CI's docker job builds
 * and runs the image itself; this checks that the job is there.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (file: string) => fs.readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)), "utf8");

describe("deploy configuration", () => {
  it("runs the image as node, with an uploads/ directory node owns", () => {
    const dockerfile = read("Dockerfile");

    expect(dockerfile.match(/^USER\s+(\S+)/gm)?.at(-1)).toBe("USER node");
    expect(dockerfile).toMatch(/^RUN mkdir -p uploads && chown node:node uploads$/m);
  });

  it("has CI build the image and run it as Railway will, against Postgres, through its healthcheck and an upload", () => {
    const job = /^ {2}docker:\n((?:(?: {4}.*)?\n)+)/m.exec(read(".github/workflows/ci.yml"))?.[1] ?? "";
    const { deploy } = JSON.parse(read("railway.json")) as { deploy: { healthcheckPath: string } };

    expect(job).toMatch(/^\s+- run: docker build --tag pokerpal:ci \.$/m);
    expect(job).toMatch(/docker run --detach --name pokerpal [\s\S]*--env DATABASE_URL=postgres:\/\/\S+\/pokerpal_docker[\s\S]*pokerpal:ci/);
    expect(job).toMatch(/POSTGRES_DB: pokerpal_docker/);
    expect(job).toContain(`curl -fsS http://localhost:3000${deploy.healthcheckPath} `);
    expect(job).toContain("http://localhost:3000/api/upload/public");
    // Production without R2 refuses uploads unless UPLOAD_DIR names where they go.
    expect(job).toMatch(/--env UPLOAD_DIR=\/app\/uploads/);
    expect(job).toMatch(/docker exec pokerpal sh -c 'test "\$\(id -un\)" = node/);
  });

  it("runs the compose app as root while it mounts a host directory over uploads/", () => {
    const compose = read("docker-compose.yml");

    expect(compose).toMatch(/^\s+- \.\/uploads:\/app\/uploads$/m);
    expect(compose).toMatch(/^\s+- UPLOAD_DIR=\/app\/uploads$/m);
    expect(compose).toMatch(/^ {4}user: root$/m);
  });
});
