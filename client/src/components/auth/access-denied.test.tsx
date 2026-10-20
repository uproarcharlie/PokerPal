import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mockSignedIn, renderWithApp } from "@test/helpers/web";
import { AccessDenied } from "./access-denied";

describe("AccessDenied", () => {
  it("says why, as the page's heading, with one link out", async () => {
    mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
    renderWithApp(<AccessDenied message="Only this club's staff can run it." backHref="/clubs" backLabel="Back to Clubs" />);

    expect(screen.getByRole("heading", { level: 1, name: "Access Denied" })).toBeInTheDocument();
    expect(screen.getByText("Only this club's staff can run it.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Clubs" })).toHaveAttribute("href", "/clubs");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
