import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeviceStore } from "./device-store";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("createDeviceStore", () => {
  it("keeps text under its prefix, and removes it for null", () => {
    const store = createDeviceStore("pokerpal.test.");
    store.write("volume", "0.4");
    expect(window.localStorage.getItem("pokerpal.test.volume")).toBe("0.4");
    expect(store.read("volume")).toBe("0.4");
    store.write("volume", null);
    expect(window.localStorage.getItem("pokerpal.test.volume")).toBeNull();
    expect(store.read("volume")).toBeNull();
  });

  it("holds what a browser refuses to store while the page is open, and reads nothing it cannot read", () => {
    const store = createDeviceStore("pokerpal.test.");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("refused", "QuotaExceededError");
    });
    store.write("margin", "5");
    expect(store.read("margin")).toBe("5");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("refused", "SecurityError");
    });
    expect(store.read("other")).toBeNull();
    expect(store.read("margin")).toBe("5");
  });

  it("tells its readers of a change here and of one another tab made to its keys only", () => {
    const store = createDeviceStore("pokerpal.test.");
    const heard = vi.fn();
    const stop = store.subscribe(heard);
    store.write("a", "1");
    expect(heard).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent("storage", { key: "pokerpal.test.a" }));
    window.dispatchEvent(new StorageEvent("storage", { key: "pokerpal.other.a" }));
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(heard).toHaveBeenCalledTimes(3);
    stop();
    store.write("a", "2");
    window.dispatchEvent(new StorageEvent("storage", { key: "pokerpal.test.a" }));
    expect(heard).toHaveBeenCalledTimes(3);
  });
});
