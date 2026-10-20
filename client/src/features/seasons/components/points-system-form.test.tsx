import { screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { pointsSystemDto } from "@test/helpers/f4-seasons";
import { apiError, mockSignedOut, renderWithApp } from "@test/helpers/web";
import { server } from "@test/msw/server";
import { PointsSystemForm } from "./points-system-form";

function renderForm() {
  const user = userEvent.setup();
  return { user, ...renderWithApp(<PointsSystemForm seasonId="s1" />) };
}

/** Adds a row and fills the boxes given (blank ones stay blank). */
async function addRow(user: UserEvent, row: { position?: string; end?: string; points?: string; label?: string }) {
  await user.click(screen.getByRole("button", { name: "Add Position" }));
  const rows = screen.getAllByTestId(/^allocation-row-/);
  const last = within(rows[rows.length - 1]);
  if (row.position) await user.type(last.getByLabelText(/^Position/), row.position);
  if (row.end) await user.type(last.getByLabelText(/^End \(optional\)/), row.end);
  if (row.points) await user.type(last.getByLabelText(/^Points/), row.points);
  if (row.label) await user.type(last.getByLabelText(/^Label/), row.label);
}

function captureCreate(answer?: () => Response) {
  const sent: unknown[] = [];
  server.use(
    http.post("/api/seasons/s1/points-systems", async ({ request }) => {
      sent.push(await request.json());
      return answer?.() ?? HttpResponse.json(pointsSystemDto({ id: "ps9", seasonId: "s1", name: "League" }), { status: 201 });
    }),
  );
  return sent;
}

beforeEach(() => mockSignedOut());

describe("PointsSystemForm", () => {
  it("creates the system and its position points in one request, then starts afresh", async () => {
    const sent = captureCreate();
    const { user } = renderForm();

    await user.type(screen.getByLabelText("System Name*"), "League");
    await user.clear(screen.getByLabelText("Participation Points"));
    await user.type(screen.getByLabelText("Participation Points"), "10");
    await user.clear(screen.getByLabelText("Knockout Points"));
    await user.type(screen.getByLabelText("Knockout Points"), "5");
    await addRow(user, { position: "1", points: "100", label: "Winner" });
    await addRow(user, { position: "2", end: "3", points: "50" });
    await user.click(screen.getByRole("button", { name: "Create Points System" }));

    expect(await screen.findByText("Points system created successfully!")).toBeInTheDocument();
    expect(sent).toEqual([
      {
        name: "League",
        description: null,
        participationPoints: 10,
        knockoutPoints: 5,
        allocations: [
          { position: 1, positionEnd: null, points: 100, description: "Winner" },
          { position: 2, positionEnd: 3, points: 50, description: null },
        ],
      },
    ]);
    expect(screen.getByLabelText("System Name*")).toHaveValue("");
    expect(screen.queryAllByTestId(/^allocation-row-/)).toHaveLength(0);
  });

  it("sends whole numbers, never text, and leaves blank bonus points to the server's default", async () => {
    const sent = captureCreate();
    const { user } = renderForm();

    await user.type(screen.getByLabelText("System Name*"), "Placings only");
    await user.clear(screen.getByLabelText("Participation Points"));
    await user.clear(screen.getByLabelText("Knockout Points"));
    await user.click(screen.getByRole("button", { name: "Create Points System" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ name: "Placings only", description: null, allocations: [] });
  });

  it("types whole numbers into text boxes, and says so when a box holds something else (P3REV2-CQ-03)", async () => {
    const sent = captureCreate();
    const { user } = renderForm();

    await user.type(screen.getByLabelText("System Name*"), "Season");
    const knockouts = screen.getByLabelText("Knockout Points");
    expect(knockouts).toHaveAttribute("inputmode", "numeric");
    await user.clear(knockouts);
    await user.type(knockouts, "two");
    await user.click(screen.getByRole("button", { name: "Create Points System" }));

    expect(await screen.findByText("Must be a whole number")).toBeInTheDocument();
    expect(sent).toHaveLength(0);
  });

  it("asks for a name, and a position and points on every row", async () => {
    const sent = captureCreate();
    const { user } = renderForm();

    await addRow(user, { label: "Winner" });
    await user.click(screen.getByRole("button", { name: "Create Points System" }));

    const row = within(screen.getByTestId("allocation-row-0"));
    expect(await row.findAllByText("Required")).toHaveLength(2);
    expect(row.getByLabelText(/^Position/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("System Name*")).toHaveAttribute("aria-invalid", "true");
    expect(sent).toHaveLength(0);
  });

  it("refuses overlapping positions before sending anything", async () => {
    const sent = captureCreate();
    const { user } = renderForm();

    await user.type(screen.getByLabelText("System Name*"), "League");
    await addRow(user, { position: "1", end: "3", points: "100" });
    await addRow(user, { position: "2", points: "50" });
    await user.click(screen.getByRole("button", { name: "Create Points System" }));

    expect(await within(screen.getByTestId("allocation-row-1")).findByText("Overlaps another allocation")).toBeInTheDocument();
    expect(sent).toHaveLength(0);
  });

  it("refuses a range that ends before it starts", async () => {
    captureCreate();
    const { user } = renderForm();

    await user.type(screen.getByLabelText("System Name*"), "League");
    await addRow(user, { position: "5", end: "2", points: "10" });
    await user.click(screen.getByRole("button", { name: "Create Points System" }));

    expect(await screen.findByText("The last position must not be before the first")).toBeInTheDocument();
  });

  it("removes the row asked for, keeping the others' values", async () => {
    const { user } = renderForm();

    await addRow(user, { position: "1", points: "100" });
    await addRow(user, { position: "2", points: "70" });
    await user.click(screen.getByRole("button", { name: "Remove row 1" }));

    const rows = screen.getAllByTestId(/^allocation-row-/);
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByLabelText(/^Position/)).toHaveValue("2");
    expect(within(rows[0]).getByLabelText(/^Points/)).toHaveValue("70");
  });

  it("keeps focus on the rows when a row's Remove takes itself away (P3REV-MA-FOCUS-AFTER-REMOVE)", async () => {
    const { user } = renderForm();
    await addRow(user, { position: "1", points: "100" });
    await addRow(user, { position: "2", points: "70" });
    await addRow(user, { position: "3", points: "50" });

    // The row now in its place, the one before when it was the last, then Add Position.
    await user.click(screen.getByRole("button", { name: "Remove row 2" }));
    expect(screen.getByRole("button", { name: "Remove row 2" })).toHaveFocus();
    expect(within(screen.getByTestId("allocation-row-1")).getByLabelText(/^Position/)).toHaveValue("3");
    await user.click(screen.getByRole("button", { name: "Remove row 2" }));
    expect(screen.getByRole("button", { name: "Remove row 1" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Remove row 1" }));
    expect(screen.getByRole("button", { name: "Add Position" })).toHaveFocus();
  });

  it("puts the server's VALIDATION problems on the row they name", async () => {
    captureCreate(() =>
      apiError(400, "VALIDATION", "Invalid points system data", [
        { code: "custom", path: ["allocations", 0, "position"], message: "Overlaps another allocation" },
      ]),
    );
    const { user } = renderForm();

    await user.type(screen.getByLabelText("System Name*"), "League");
    await addRow(user, { position: "1", points: "100" });
    await user.click(screen.getByRole("button", { name: "Create Points System" }));

    expect(await within(screen.getByTestId("allocation-row-0")).findByText("Overlaps another allocation")).toBeInTheDocument();
  });

  it("shows any other refusal as the server's sentence and keeps what was typed", async () => {
    captureCreate(() => apiError(403, "FORBIDDEN", "Only the club's staff can do that"));
    const { user } = renderForm();

    await user.type(screen.getByLabelText("System Name*"), "League");
    await user.click(screen.getByRole("button", { name: "Create Points System" }));

    expect(await screen.findByText("Only the club's staff can do that")).toBeInTheDocument();
    expect(screen.getByLabelText("System Name*")).toHaveValue("League");
  });

  it("keeps Create busy while the system is being saved, with focus still on it (MA-REV-02)", async () => {
    let release: () => void = () => {};
    server.use(
      http.post("/api/seasons/s1/points-systems", async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return HttpResponse.json(pointsSystemDto({ id: "ps9", seasonId: "s1", name: "League" }), { status: 201 });
      }),
    );
    const { user } = renderForm();

    await user.type(screen.getByLabelText("System Name*"), "League");
    await user.click(screen.getByRole("button", { name: "Create Points System" }));

    const creating = await screen.findByRole("button", { name: "Creating..." });
    expect(creating).toHaveAttribute("aria-disabled", "true");
    expect(creating).toHaveFocus();
    release();
    expect(await screen.findByText("Points system created successfully!")).toBeInTheDocument();
    // The form stays on screen after a save: the person is still on its button, not back at the page's top.
    expect(screen.getByRole("button", { name: "Create Points System" })).toHaveFocus();
  });
});
