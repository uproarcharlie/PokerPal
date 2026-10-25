import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mockSignedIn, renderWithApp } from "@test/helpers/web";
import { DisplayLayout } from "./display-layout";

const MANAGER = { id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" } as const;
const ADMIN = { id: "a1", name: "Ada Admin", email: "ada@lovepoker.test" };

describe("DisplayLayout", () => {
  it("tells an admin viewing as a club's manager so on the TV clock, without naming the admin to the room (P4REV3-SEC-03)", async () => {
    mockSignedIn(MANAGER, { impersonator: ADMIN });
    renderWithApp(
      <DisplayLayout>
        <p>The clock</p>
      </DisplayLayout>,
    );
    const banner = await screen.findByRole("status", { name: "Impersonation" });
    expect(banner).toHaveTextContent("Viewing as Tess TD");
    expect(banner).not.toHaveTextContent("Ada Admin");
    expect(banner).toHaveAttribute("data-placement", "top");
    expect(screen.getByRole("button", { name: "Exit" })).toBeInTheDocument();
  });

  it("shows only the clock to anyone signed in as themselves", async () => {
    mockSignedIn(MANAGER);
    renderWithApp(
      <DisplayLayout>
        <p>The clock</p>
      </DisplayLayout>,
    );
    expect(await screen.findByText("The clock")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("status", { name: "Impersonation" })).not.toBeInTheDocument());
  });
});
