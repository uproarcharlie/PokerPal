import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mockSignedOut, renderWithApp } from "@test/helpers/web";
import { Button } from "@/components/ui/button";
import { PageHeader } from "./page-header";

describe("PageHeader", () => {
  it("has the page's heading, a link back and its actions", () => {
    mockSignedOut();
    renderWithApp(<PageHeader title="Friday Freezeout" description="Central Stars" back={{ href: "/tournaments", label: "Tournaments" }} actions={<Button>Edit</Button>} />);

    expect(screen.getByRole("heading", { level: 1, name: "Friday Freezeout" })).toBeInTheDocument();
    expect(screen.getByText("Central Stars")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tournaments" })).toHaveAttribute("href", "/tournaments");
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("stays pinned only from tablet width, so on a phone it scrolls away with the page (MA-01)", () => {
    mockSignedOut();
    renderWithApp(<PageHeader title="Friday Freezeout" actions={<Button>Edit</Button>} />);

    const classes = screen.getByRole("banner").className.split(/\s+/);
    expect(classes).toContain("md:sticky");
    expect(classes).not.toContain("sticky");
  });
});
