import { useState } from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useQuery } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { sessionUser } from "@test/helpers/f5-dto";
import { apiError, mockSignedIn, mockSignedOut, renderWithApp } from "@test/helpers/web";
import { apiGet, errorMessage } from "@/lib/api/http";
import { qk } from "@/lib/api/query-keys";
import { useAuth } from "./auth-context";

const TD = { id: "td", name: "Tess TD", email: "tess@club.test", role: "full_member" as const };
const tess = sessionUser({ id: TD.id, name: TD.name, email: TD.email });

/** A staff control gated, as the pages gate theirs, on the cached tournament's viewer flags. */
function TournamentControls() {
  const { login, logout, user } = useAuth();
  const { data } = useQuery({
    queryKey: qk.tournaments.detail("t1"),
    queryFn: ({ signal }) => apiGet<{ viewer: { canManage: boolean } }>("/api/tournaments/t1", { signal }),
  });
  return (
    <div>
      <p>{data ? (data.viewer.canManage ? "Start Tournament" : "View only") : "Loading"}</p>
      <p data-testid="who">{user?.name ?? "nobody"}</p>
      <button onClick={() => void login(TD.email, "Sturdy-Pass2").catch(() => {})}>Sign in</button>
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
      http.post("/api/auth/login", () => HttpResponse.json({ message: "Login successful", user: tess })),
    );
    renderWithApp(<TournamentControls />);
    expect(await screen.findByText("View only")).toBeInTheDocument();

    manages = true;
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Start Tournament")).toBeInTheDocument();
    expect(screen.getByTestId("who")).toHaveTextContent("Tess TD");
    expect(screen.getByText("Welcome back, Tess TD!")).toBeInTheDocument();
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
    expect(screen.getByTestId("who")).toHaveTextContent("nobody");
    await waitFor(() => expect(queryClient.getQueryData(qk.tournaments.detail("t1"))).toEqual({ viewer: { canManage: false } }));
  });
});

/** Shows what sign-in hands back, as the sign-in page does. */
function SignIn() {
  const { login } = useAuth();
  const [refusal, setRefusal] = useState("");
  return (
    <>
      <button onClick={() => login(TD.email, "wrong").catch((error: unknown) => setRefusal(errorMessage(error)))}>Sign in</button>
      <p data-testid="refusal">{refusal}</p>
    </>
  );
}

describe("AuthProvider sign-in and sign-out", () => {
  it("hands a refused sign-in back to the page to show, without a toast of its own", async () => {
    mockSignedOut();
    server.use(http.post("/api/auth/login", () => apiError(401, "INVALID_CREDENTIALS", "Invalid email or password")));
    renderWithApp(<SignIn />);

    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(screen.getByTestId("refusal")).toHaveTextContent("Invalid email or password"));
    expect(screen.queryByText("Login failed")).not.toBeInTheDocument();
    // A wrong password is not a session that ended.
    expect(screen.queryByText("Signed out")).not.toBeInTheDocument();
  });

  it("keeps the user signed in and says so when signing out fails", async () => {
    mockSignedIn(TD);
    server.use(
      http.get("/api/tournaments/t1", () => HttpResponse.json({ viewer: { canManage: true } })),
      http.post("/api/auth/logout", () => apiError(500, "INTERNAL", "Something went wrong on our side. Please try again.")),
    );
    renderWithApp(<TournamentControls />);
    expect(await screen.findByText("Start Tournament")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(await screen.findByText("Logout failed")).toBeInTheDocument();
    expect(screen.getByTestId("who")).toHaveTextContent("Tess TD");
  });

  it("asks again when the server cannot be reached at start, and keeps the user signed in once it answers (P3REV4-PERF-04)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let asked = 0;
    server.use(
      http.get("/api/auth/me", () => {
        asked += 1;
        return asked === 1 ? HttpResponse.error() : asked === 2 ? apiError(503, "SERVICE_UNAVAILABLE", "Busy") : HttpResponse.json({ user: tess });
      }),
      http.get("/api/tournaments/t1", () => HttpResponse.json({ viewer: { canManage: true } })),
    );
    renderWithApp(<SessionProbe />);

    await vi.advanceTimersByTimeAsync(3100);

    await waitFor(() => expect(screen.getByTestId("who")).toHaveTextContent("Tess TD"));
    expect(asked).toBe(3);
    expect(screen.getByTestId("check")).toHaveTextContent("ok");
    vi.useRealTimers();
  });

  it("says the check failed, rather than that nobody is signed in, when the server stays unreachable, and tries again on request", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    let reachable = false;
    server.use(http.get("/api/auth/me", () => (reachable ? HttpResponse.json({ user: tess }) : HttpResponse.error())));
    renderWithApp(<SessionProbe />);

    await vi.advanceTimersByTimeAsync(3100);
    await waitFor(() => expect(screen.getByTestId("check")).toHaveTextContent("failed"));
    expect(screen.getByTestId("who")).toHaveTextContent("nobody");

    reachable = true;
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));

    await waitFor(() => expect(screen.getByTestId("who")).toHaveTextContent("Tess TD"));
    expect(screen.getByTestId("check")).toHaveTextContent("ok");
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("asks once only for a refusal, as every read does: a 4xx other than 401 is not asked again (P3REV5-CQ-14)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let asked = 0;
    server.use(
      http.get("/api/auth/me", () => {
        asked += 1;
        return apiError(429, "RATE_LIMITED", "Too many requests");
      }),
    );
    renderWithApp(<SessionProbe />);

    await waitFor(() => expect(screen.getByTestId("check")).toHaveTextContent("failed"));
    expect(asked).toBe(1);
    vi.restoreAllMocks();
  });

  it("treats only a 401 at start as nobody signed in, at once", async () => {
    mockSignedOut();
    renderWithApp(<SessionProbe />);

    await waitFor(() => expect(screen.getByTestId("check")).toHaveTextContent("ok"));
    expect(screen.getByTestId("who")).toHaveTextContent("nobody");
  });
});

function SessionProbe() {
  const { user, loading, sessionCheckFailed, retrySessionCheck } = useAuth();
  return (
    <div>
      <p data-testid="who">{user?.name ?? "nobody"}</p>
      <p data-testid="check">{loading ? "checking" : sessionCheckFailed ? "failed" : "ok"}</p>
      <button onClick={retrySessionCheck}>Check again</button>
    </div>
  );
}

function ProfileProbe() {
  const { user, updateSessionUser } = useAuth();
  return (
    <div>
      <p data-testid="who">{user?.name ?? "nobody"}</p>
      <button onClick={() => updateSessionUser({ ...tess, name: "Tess Renamed" })}>Rename</button>
      <button onClick={() => updateSessionUser({ ...tess, id: "someone-else", name: "Other" })}>Rename other</button>
    </div>
  );
}

describe("AuthProvider.updateSessionUser", () => {
  it("shows the saved name at once, and ignores an account that is not the signed-in one", async () => {
    mockSignedIn(TD);
    renderWithApp(<ProfileProbe />);
    await waitFor(() => expect(screen.getByTestId("who")).toHaveTextContent("Tess TD"));

    await userEvent.click(screen.getByRole("button", { name: "Rename other" }));
    expect(screen.getByTestId("who")).toHaveTextContent("Tess TD");

    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByTestId("who")).toHaveTextContent("Tess Renamed");
  });
});
