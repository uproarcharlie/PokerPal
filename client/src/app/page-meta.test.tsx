import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePageMeta } from "./page-meta";

function Page({ title, noindex }: { title?: string; noindex?: boolean }) {
  usePageMeta({ title, noindex });
  return null;
}

describe("usePageMeta", () => {
  it("titles the tab and keeps search engines off player pages while shown, then puts things back", () => {
    document.title = "LovePoker.club - Where Poker Communities Thrive";
    const { unmount } = render(<Page title="Friday Freezeout" noindex />);

    expect(document.title).toBe("Friday Freezeout | LovePoker.club");
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex");

    unmount();

    expect(document.title).toBe("LovePoker.club - Where Poker Communities Thrive");
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  });
});
