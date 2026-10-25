import { describe, expect, it, vi } from "vitest";
import { AVATAR_IDS, avatarUrl } from "@shared/domain/avatars";
import { imageVariantsFromUrl } from "@shared/domain/images";
import { solidImage } from "../../../test/helpers/images";
import { loadEnv } from "../../config/env";
import { HttpError } from "../../http/errors";
import type { ImageStore } from "./store";
import { assertOwnedImage, logOrphanedImages, noteDeletedImages, noteReplacedImage, saveUploadedImage } from "./upload";

/** An ImageStore in memory, optionally failing for keys that match `failOn`. */
function memoryStore(failOn?: RegExp) {
  const objects = new Map<string, Buffer>();
  const store: ImageStore = {
    kind: "local",
    put: async (key, body) => {
      if (failOn?.test(key)) throw new Error("disk full");
      objects.set(key, body);
    },
    publicUrl: (key) => `https://img.test/${key}`,
    owns: (url) => url.startsWith("https://img.test/"),
    describe: () => "memory",
  };
  return { store, objects };
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

describe("saveUploadedImage", () => {
  it("stores every variant under one new id and answers with their URLs", async () => {
    const { store, objects } = memoryStore();

    const saved = await saveUploadedImage(store, "player_avatar", await solidImage(300, 300));

    expect(saved).toMatchObject({ kind: "player_avatar", width: 256, height: 256, dominantColor: "#dc2828" });
    expect(saved.url).toMatch(new RegExp(`^https://img\\.test/player_avatar/${UUID}/256\\.webp$`));
    expect(saved.variants).toEqual(imageVariantsFromUrl(saved.url));
    expect(Object.keys(saved.variants)).toEqual(["48", "96", "256"]);
    expect(Array.from(objects.keys()).map((key) => `https://img.test/${key}`).sort()).toEqual(Object.values(saved.variants).sort());
  });

  it("gives every upload its own id", async () => {
    const { store } = memoryStore();
    const image = await solidImage(50, 50);

    const [first, second] = await Promise.all([saveUploadedImage(store, "player_avatar", image), saveUploadedImage(store, "player_avatar", image)]);

    expect(first.url).not.toBe(second.url);
  });

  it("stores nothing for a file it cannot read", async () => {
    const { store, objects } = memoryStore();

    await expect(saveUploadedImage(store, "club_logo", Buffer.from("nope"))).rejects.toMatchObject({ status: 415 });
    expect(objects.size).toBe(0);
  });

  it("answers 503 when the store fails part-way, and logs what it did write as orphans", async () => {
    const { store, objects } = memoryStore(/\/96\.webp$/);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const failure = await saveUploadedImage(store, "player_avatar", await solidImage(300, 300)).catch((reason: unknown) => reason);

    expect(failure).toBeInstanceOf(HttpError);
    expect(failure).toMatchObject({ status: 503, code: "STORAGE_UNAVAILABLE" });
    expect(objects.size).toBe(2);
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/^\[images\] orphaned, kept \(an upload that failed part-way\): https:\/\/img\.test\/\S+ https:\/\/img\.test\/\S+$/));
    expect(error).toHaveBeenCalledWith("Storing an image failed:", expect.any(Error));
    info.mockRestore();
    error.mockRestore();
  });
});

describe("orphaned images", () => {
  const STORED = "https://img.test/club_logo/0b9e7c2a-5d1f-4c3e-9a8b-7f6e5d4c3b2a/128.webp";

  it("logs every variant of an image a change replaced or removed, and deletes nothing", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    noteReplacedImage(STORED, null, "club c1");
    noteReplacedImage("/uploads/clubs/image-1-2.webp", "/uploads/club_logo/new.webp", "club c2");

    expect(info.mock.calls).toEqual([
      [`[images] orphaned, kept (replaced on club c1): ${STORED.replace("128", "64")} ${STORED}`],
      ["[images] orphaned, kept (replaced on club c2): /uploads/clubs/image-1-2.webp"],
    ]);
    info.mockRestore();
  });

  it("logs nothing when the image did not change or there was none", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    noteReplacedImage(STORED, STORED, "club c1");
    noteReplacedImage(null, STORED, "club c1");
    noteReplacedImage("", undefined, "club c1");
    logOrphanedImages([], "nothing");

    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });
});

describe("built-in avatars (round 5)", () => {
  const env = loadEnv({ DATABASE_URL: "postgres://app@localhost:5432/pokerpal", NODE_ENV: "test" });
  const UPLOAD = "/uploads/player_avatar/0b9e7c2a-5d1f-4c3e-9a8b-7f6e5d4c3b2a/256.webp";
  const refusal = (next: string, previous: string | null = null) => {
    try {
      assertOwnedImage(env, next, previous, "Invalid player data");
      return null;
    } catch (error) {
      return error;
    }
  };

  it("accepts every avatar as a new picture without the own-storage check, and nothing that only looks like one", () => {
    for (const id of AVATAR_IDS) expect(refusal(avatarUrl(id))).toBeNull();
    expect(refusal(UPLOAD)).toBeNull();

    for (const near of ["/avatars/unicorn.svg", "/avatars/shark.png", "https://evil.example/avatars/shark.svg", "/avatars/../uploads/x.svg"]) {
      expect(refusal(near)).toMatchObject({ status: 400, code: "VALIDATION", details: [{ path: ["imageUrl"] }] });
    }
  });

  it("never logs an avatar as an orphaned upload, when it is replaced or its row deleted", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    noteReplacedImage(avatarUrl("shark"), UPLOAD, "player p1");
    noteReplacedImage(avatarUrl("shark"), null, "player p1");
    noteDeletedImages([avatarUrl("crown"), null], "player p2");
    expect(info).not.toHaveBeenCalled();

    // A photo replaced by an avatar is still an orphan, with every variant it has.
    noteReplacedImage(UPLOAD, avatarUrl("spade"), "player p3");
    expect(info.mock.calls).toEqual([
      [`[images] orphaned, kept (replaced on player p3): ${["48", "96", "256"].map((width) => UPLOAD.replace("256", width)).join(" ")}`],
    ]);
    info.mockRestore();
  });
});
