import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useQuery } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedOut, renderWithApp } from "@test/helpers/web";
import { apiGet } from "@/lib/api/http";
import { EmptyState, QueryState } from "./query-state";

function Seasons({ stateClassName }: { stateClassName?: string }) {
  const query = useQuery({ queryKey: ["seasons", "list", {}], queryFn: () => apiGet<{ id: string; name: string }[]>("/api/seasons") });
  return (
    <QueryState
      query={query}
      stateClassName={stateClassName}
      empty={<EmptyState title="No seasons yet" />}
      notFound={<p>That club has gone</p>}
      errorTitle="Seasons could not be loaded"
    >
      {(seasons) => (
        <ul>
          {seasons.map((season) => (
            <li key={season.id}>{season.name}</li>
          ))}
        </ul>
      )}
    </QueryState>
  );
}

describe("QueryState", () => {
  it("shows a loading state, then the data", async () => {
    mockSignedOut();
    server.use(http.get("/api/seasons", () => HttpResponse.json([{ id: "s1", name: "Spring 2026" }])));
    renderWithApp(<Seasons />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(await screen.findByText("Spring 2026")).toBeInTheDocument();
  });

  it("shows the empty state for no rows, never an empty list", async () => {
    mockSignedOut();
    server.use(http.get("/api/seasons", () => HttpResponse.json([])));
    renderWithApp(<Seasons />);

    expect(await screen.findByRole("heading", { name: "No seasons yet" })).toBeInTheDocument();
  });

  it("shows the server's reason with a retry that asks again", async () => {
    mockSignedOut();
    let calls = 0;
    server.use(
      http.get("/api/seasons", () => {
        calls += 1;
        return calls === 1 ? apiError(503, "SERVICE_UNAVAILABLE", "The server is busy right now") : HttpResponse.json([{ id: "s1", name: "Spring 2026" }]);
      }),
    );
    renderWithApp(<Seasons />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Seasons could not be loaded");
    expect(alert).toHaveTextContent("The server is busy right now");

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Spring 2026")).toBeInTheDocument();
  });

  it("puts focus back on Try again when the retry fails too, so the person keeps their place (P3REV3-CQ-06)", async () => {
    mockSignedOut();
    let calls = 0;
    let answer: () => void = () => {};
    server.use(
      http.get("/api/seasons", async () => {
        calls += 1;
        // The retry's answer waits, as it would over the venue's Wi-Fi, so the loading state shows.
        if (calls > 1) await new Promise<void>((resolve) => (answer = resolve));
        return apiError(503, "SERVICE_UNAVAILABLE", "The server is busy right now");
      }),
    );
    const user = userEvent.setup();
    renderWithApp(<Seasons />);

    await user.click(await screen.findByRole("button", { name: "Try again" }));
    // The error gives way to the loading state, taking the pressed button with it...
    expect(await screen.findByRole("status")).toHaveTextContent("Loading");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    answer();
    // ...and comes back with a new one, which has focus.
    expect(await screen.findByRole("button", { name: "Try again" })).toHaveFocus();
    expect(calls).toBe(2);
  });

  it("can show a 404 as its own state", async () => {
    mockSignedOut();
    server.use(http.get("/api/seasons", () => apiError(404, "NOT_FOUND", "Club not found")));
    renderWithApp(<Seasons />);

    expect(await screen.findByText("That club has gone")).toBeInTheDocument();
  });

  it("keeps the data on screen when a later refetch fails", async () => {
    mockSignedOut();
    let calls = 0;
    server.use(
      http.get("/api/seasons", () => {
        calls += 1;
        return calls === 1 ? HttpResponse.json([{ id: "s1", name: "Spring 2026" }]) : apiError(503, "SERVICE_UNAVAILABLE", "The server is busy right now");
      }),
    );
    const { queryClient } = renderWithApp(<Seasons />);
    expect(await screen.findByText("Spring 2026")).toBeInTheDocument();

    await act(() => queryClient.refetchQueries({ queryKey: ["seasons"] }));

    expect(calls).toBe(2);
    expect(queryClient.getQueryState(["seasons", "list", {}])?.status).toBe("error");
    expect(screen.getByText("Spring 2026")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the 404 state once what was on screen has been deleted meanwhile (P3REV4-PERF-D)", async () => {
    mockSignedOut();
    let calls = 0;
    server.use(
      http.get("/api/seasons", () => {
        calls += 1;
        return calls === 1 ? HttpResponse.json([{ id: "s1", name: "Spring 2026" }]) : apiError(404, "NOT_FOUND", "Club not found");
      }),
    );
    const { queryClient } = renderWithApp(<Seasons />);
    expect(await screen.findByText("Spring 2026")).toBeInTheDocument();

    await act(() => queryClient.refetchQueries({ queryKey: ["seasons"] }));

    expect(await screen.findByText("That club has gone")).toBeInTheDocument();
    expect(screen.queryByText("Spring 2026")).not.toBeInTheDocument();
  });

  it("frames its states, but not the loaded content, in the page's own box (P3REV2-CQ-09)", async () => {
    mockSignedOut();
    let fail = true;
    server.use(
      http.get("/api/seasons", () => (fail ? apiError(503, "SERVICE_UNAVAILABLE", "The server is busy right now") : HttpResponse.json([{ id: "s1", name: "Spring 2026" }]))),
    );
    renderWithApp(<Seasons stateClassName="page-frame" />);

    const alert = await screen.findByRole("alert");
    expect(alert.parentElement).toHaveClass("page-frame");

    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    const list = (await screen.findByText("Spring 2026")).closest("ul");
    expect(list?.parentElement).not.toHaveClass("page-frame");
  });
});
