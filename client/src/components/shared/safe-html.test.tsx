import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SafeHtml } from "./safe-html";

describe("SafeHtml", () => {
  it("keeps the allowed formatting and drops anything that could run", () => {
    const { container } = render(
      <SafeHtml
        className="prose"
        html={'<p>Fridays at <strong>Club 2020</strong></p><script>alert(1)</script><img src=x onerror="alert(1)"><a href="javascript:alert(1)">x</a><a href="https://example.com">site</a>'}
      />,
    );

    const box = container.firstElementChild as HTMLElement;
    expect(box).toHaveClass("prose");
    expect(box.querySelector("strong")).toHaveTextContent("Club 2020");
    expect(box.querySelector("script, img, [onerror]")).toBeNull();
    expect(box.querySelector('a[href^="javascript"]')).toBeNull();
    expect(box.querySelector('a[href="https://example.com/"]')).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });
});
