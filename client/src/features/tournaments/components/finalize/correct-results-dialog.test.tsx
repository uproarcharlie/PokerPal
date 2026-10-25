import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { prizePoolSnapshotDto } from "@test/helpers/dto";
import { mockSignedOut, renderWithApp } from "@test/helpers/web";
import { alice, bob, carl, HASH_A, mockPreview, planRow as row, previewOf as preview, tournamentDto } from "@test/helpers/f1-tournaments";
import { CorrectResultsDialog } from "./correct-results-dialog";

beforeEach(() => {
  mockSignedOut();
  // The tournament as finalized, without a deal (finalize-deal.test.tsx has the corrections with one).
  server.use(http.get("/api/tournaments/t1", () => HttpResponse.json(tournamentDto({ status: "completed", prizePoolSnapshot: prizePoolSnapshotDto() }))));
});

describe("CorrectResultsDialog (P2REV1-01)", () => {
  it("shows each player's points beside what was stored before, and the warning when points would change", async () => {
    const pointsWarning = "Season points change for 1 player whose place stays the same: Carl 20 → none";
    mockPreview(() =>
      preview({
        planHash: HASH_A,
        requiresForce: true,
        rows: [
          { ...row(bob, 1, 23_800), pointsAwarded: 100 },
          { ...row(alice, 2, 14_200), pointsAwarded: 50 },
          { ...row(carl, 3, 9_500), pointsAwarded: null },
        ],
        warnings: ["Finalizing again replaces the stored positions, prizes and points", pointsWarning],
        previous: {
          finalizedAt: "2026-10-01T10:00:00.000Z",
          rows: [],
          results: [
            { registrationId: "r1", finalPosition: 1, pointsAwarded: 100 },
            { registrationId: "r2", finalPosition: 2, pointsAwarded: 50 },
            { registrationId: "r3", finalPosition: 3, pointsAwarded: 20 },
          ],
        },
      }),
    );
    renderWithApp(<CorrectResultsDialog open onOpenChange={vi.fn()} tournamentId="t1" finishers={[alice, bob, carl]} />);

    expect(await screen.findByTestId("finalize-warnings")).toHaveTextContent(pointsWarning);
    expect(screen.getByTestId("plan-points-r2")).toHaveTextContent("100(was 50)");
    expect(screen.getByTestId("plan-points-r1")).toHaveTextContent("50(was 100)");
    expect(screen.getByTestId("plan-points-r3")).toHaveTextContent("-(was 20)");
  });

  it("keeps the points column when every new row has none but the stored results had points", async () => {
    mockPreview(() =>
      preview({
        planHash: HASH_A,
        requiresForce: true,
        rows: [row(alice, 1, 23_800), row(bob, 2, 14_200)],
        previous: {
          finalizedAt: null,
          rows: [],
          results: [
            { registrationId: "r1", finalPosition: 2, pointsAwarded: 50 },
            { registrationId: "r2", finalPosition: 1, pointsAwarded: 100 },
          ],
        },
      }),
    );
    renderWithApp(<CorrectResultsDialog open onOpenChange={vi.fn()} tournamentId="t1" finishers={[bob, alice]} />);

    expect(await screen.findByTestId("plan-points-r1")).toHaveTextContent("-(was 50)");
    expect(screen.getByTestId("plan-points-r2")).toHaveTextContent("-(was 100)");
  });
});
