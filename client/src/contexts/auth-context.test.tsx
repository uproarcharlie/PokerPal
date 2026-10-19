import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useQuery } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { mockSignedIn, mockSignedOut, renderWithApp } from "@test/helpers/web";
import { useAuth } from "./auth-context";

const TD = { id: "td", name: "Tess TD", email: "tess@club.test", role: "full_member" as const };
const sessionUser = { ...TD, phone: null, imageUrl: null, isActive: true, createdAt: "2026-01-01T00:00:00.000Z" };

/** A staff control gated, as the pages gate theirs, on the cached tournament's viewer flags. */
function TournamentControls() {
  const { login, logout } = useAuth();
  const { data } = useQuery<{ viewer: { canManage: boolean } }>({ queryKey: ["/api/tournaments", "t1"] });
  return (
    <div>
      <p>{data ? (data.viewer.canManage ? "Start Tournament" : "View only") : "Loading"}</p>
      <button onClick={() => void login(TD.email, "Sturdy-Pass2")}>Sign in</button>
      <button onClick={() => void logout()}>Sign out</button>
    </div>
  );
}

describe("AuthProvider and cached data (TN-07)", () => {
  it("drops what was fetched as the previous viewer when someone signs in, so their flags are fetched afresh", async () => {
    mockSignedOut();
    let manages = false;
    server.use(
      http.get("/api/tournaments/t1", () => HttpResponse.json({ viewer: { canManage: manages } })),
      http.post("/api/auth/login", () => HttpResponse.json({ message: "Login successful", user: sessionUser })),
    );
    renderWithApp(<TournamentControls />);
    expect(await screen.findByText("View only")).toBeInTheDocument();

    manages = true;
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Start Tournament")).toBeInTheDocument();
  });

  it("drops it when someone signs out, so the next person on the laptop never sees their controls", async () => {
    mockSignedIn(TD);
    let manages = true;
    server.use(
      http.get("/api/tournaments/t1", () => HttpResponse.json({ viewer: { canManage: manages } })),
      http.post("/api/auth/logout", () => HttpResponse.json({ message: "Logout successful" })),
    );
    const { queryClient } = renderWithApp(<TournamentControls />);
    expect(await screen.findByText("Start Tournament")).toBeInTheDocument();

    manages = false;
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(await screen.findByText("View only")).toBeInTheDocument();
    await waitFor(() => expect(queryClient.getQueryData(["/api/tournaments", "t1"])).toEqual({ viewer: { canManage: false } }));
  });
});
