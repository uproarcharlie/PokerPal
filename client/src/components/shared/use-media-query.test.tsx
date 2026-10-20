import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMediaQuery } from "./use-media-query";

function Probe() {
  const phone = useMediaQuery("(max-width: 767px)");
  const [renders, setRenders] = useState(0);
  return (
    <button type="button" onClick={() => setRenders(renders + 1)}>
      {phone ? "phone" : "wide"} {renders}
    </button>
  );
}

afterEach(() => vi.restoreAllMocks());

describe("useMediaQuery (P3REV-PERF-POLL-RERENDER)", () => {
  it("listens once while shown, not again on every re-render, and follows a change", () => {
    let matches = false;
    let listener: (() => void) | undefined;
    const addEventListener = vi.fn((_: string, onChange: () => void) => (listener = onChange));
    vi.spyOn(window, "matchMedia").mockImplementation(
      (media) => ({ media, get matches() { return matches; }, addEventListener, removeEventListener: vi.fn() }) as unknown as MediaQueryList,
    );
    render(<Probe />);
    const probe = screen.getByRole("button");

    for (let i = 0; i < 5; i++) act(() => probe.click());
    expect(probe).toHaveTextContent("wide 5");
    expect(addEventListener).toHaveBeenCalledTimes(1);

    matches = true;
    act(() => listener?.());
    expect(probe).toHaveTextContent("phone 5");
  });
});
