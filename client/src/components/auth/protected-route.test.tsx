import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useQuery } from "@tanstack/react-query";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import type { DashboardStatsDto } from "@shared/api/dashboard";
import { server } from "@test/msw/server";
import { sessionUser } from "@test/helpers/dto";
import { apiError, mockSignedIn, mockSignedOut, renderWithApp } from "@test/helpers/web";
import { useAuth } from "@/contexts/auth-context";
import { apiGet } from "@/lib/api/http";
import { qk } from "@/lib/api/query-keys";
import { ProtectedRoute } from "./protected-route";

const TESS = { id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" } as const;

function StaffPage() {
  const { data, error } = useQuery({
    queryKey: qk.dashboard.stats(),
    queryFn: ({ signal }) => apiGet<Pick<DashboardStatsDto, "activeClubs">>("/api/dashboard/stats", { signal }),
  });
  return <p>{error ? error.message : `Clubs: ${data?.activeClubs ?? "..."}`}</p>;
}

describe("ProtectedRoute when the sign-in cannot be checked (P3REV4-PERF-04)", () => {
  it("offers to try again, and never sends someone whose session may be fine to the sign-in page", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    let reachable = false;
    server.use(
      http.get("/api/auth/me", () => (reachable ? HttpResponse.json({ user: sessionUser(TESS) }) : HttpResponse.error())),
      http.get("/api/dashboard/stats", () => HttpResponse.json({ activeClubs: 2 })),
    );
    const { location } = renderWithApp(
      <ProtectedRoute>
        <StaffPage />
      </ProtectedRoute>,
      { path: "/dashboard" },
    );

    await vi.advanceTimersByTimeAsync(3100);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not check your sign-in");
    expect(location()).toBe("/dashboard");

    reachable = true;
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Clubs: 2")).toBeInTheDocument();
    expect(location()).toBe("/dashboard");
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
});

describe("ProtectedRoute and an ended session", () => {
  it("signs the user out and sends them to the login page when the API answers 401", async () => {
    mockSignedIn(TESS);
    server.use(http.get("/api/dashboard/stats", () => apiError(401, "UNAUTHENTICATED", "Please sign in")));
    const { location } = renderWithApp(
      <ProtectedRoute>
        <StaffPage />
      </ProtectedRoute>,
      { path: "/dashboard" },
    );

    expect(await screen.findByText("Signed out")).toBeInTheDocument();
    expect(screen.getByText("Your session has ended. Please sign in again.")).toBeInTheDocument();
    await waitFor(() => expect(location()).toBe("/login"));
  });

  it("keeps a signed-in user on the page when a request is merely refused", async () => {
    mockSignedIn(TESS);
    server.use(http.get("/api/dashboard/stats", () => apiError(403, "FORBIDDEN", "Not yours")));
    const { location } = renderWithApp(
      <ProtectedRoute>
        <StaffPage />
      </ProtectedRoute>,
      { path: "/dashboard" },
    );

    expect(await screen.findByText("Not yours")).toBeInTheDocument();
    expect(location()).toBe("/dashboard");
    expect(screen.queryByText("Signed out")).not.toBeInTheDocument();
  });

  it("shows the page when the API answers", async () => {
    mockSignedIn(TESS);
    server.use(http.get("/api/dashboard/stats", () => HttpResponse.json({ activeClubs: 2 })));
    renderWithApp(
      <ProtectedRoute>
        <StaffPage />
      </ProtectedRoute>,
      { path: "/dashboard" },
    );

    expect(await screen.findByText("Clubs: 2")).toBeInTheDocument();
  });
});

describe("ProtectedRoute", () => {
  it("says it is checking the sign-in, and shows nothing of the page, until the answer comes", async () => {
    server.use(
      http.get("/api/auth/me", async () => {
        await delay(50);
        return apiError(401, "UNAUTHENTICATED", "Not signed in");
      }),
    );
    const { location } = renderWithApp(
      <ProtectedRoute>
        <p>Staff only</p>
      </ProtectedRoute>,
      { path: "/players" },
    );

    expect(screen.getByRole("status")).toHaveTextContent("Checking your sign-in");
    expect(screen.queryByText("Staff only")).not.toBeInTheDocument();
    await waitFor(() => expect(location()).toBe("/login?next=%2Fplayers"));
  });

  it("sends someone who is not an admin away from an admin-only page, to the club directory", async () => {
    mockSignedIn(TESS);
    const { location } = renderWithApp(
      <ProtectedRoute requireAdmin>
        <p>Admins only</p>
      </ProtectedRoute>,
      { path: "/users" },
    );

    await waitFor(() => expect(location()).toBe("/home"));
    expect(screen.queryByText("Admins only")).not.toBeInTheDocument();
  });

  it("shows an admin-only page to an admin", async () => {
    mockSignedIn({ ...TESS, role: "admin" });
    renderWithApp(
      <ProtectedRoute requireAdmin>
        <p>Admins only</p>
      </ProtectedRoute>,
      { path: "/users" },
    );

    expect(await screen.findByText("Admins only")).toBeInTheDocument();
  });

  it("sends a visitor to sign in, and back to the page they asked for afterwards (PUB-23)", async () => {
    mockSignedOut();
    const { location } = renderWithApp(
      <ProtectedRoute>
        <p>Staff only</p>
      </ProtectedRoute>,
      { path: "/leaderboards?season=s1" },
    );

    await waitFor(() => expect(location()).toBe(`/login?next=${encodeURIComponent("/leaderboards?season=s1")}`));
  });

  it("sends someone who signs out to the sign-in page without a way back to the page they left", async () => {
    mockSignedIn(TESS);
    server.use(http.post("/api/auth/logout", () => HttpResponse.json({ message: "Logged out" })));
    function SignOut() {
      const { logout } = useAuth();
      return <button onClick={() => void logout()}>Log out</button>;
    }
    const { location } = renderWithApp(
      <ProtectedRoute>
        <SignOut />
      </ProtectedRoute>,
      { path: "/players" },
    );

    await userEvent.click(await screen.findByRole("button", { name: "Log out" }));

    await waitFor(() => expect(location()).toBe("/login"));
  });
});
