import { screen, waitFor } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import { ProtectedRoute } from "./protected-route";

function StaffPage() {
  const { data, error } = useQuery<{ activeClubs: number }>({ queryKey: ["/api/dashboard/stats"] });
  return <p>{error ? error.message : `Clubs: ${data?.activeClubs ?? "..."}`}</p>;
}

describe("ProtectedRoute and an ended session", () => {
  it("signs the user out and sends them to the login page when the API answers 401", async () => {
    mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
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
    mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
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
    mockSignedIn({ id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" });
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
