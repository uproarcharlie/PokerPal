import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import type { ClubDto } from "@shared/api/public";
import { server } from "@test/msw/server";
import { clubDto, MANAGER_VIEW } from "@test/helpers/dto";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import { useClub } from "@/features/clubs/hooks";
import { SignupPhotoField } from "./signup-photo-field";

const MANAGER = { id: "u1", name: "Mere Manager", email: "mere@example.test", role: "full_member" } as const;
const club = clubDto({ viewer: MANAGER_VIEW });

/**
 * The club as club settings shows it (its query), starting from `stored`; records each PUT body,
 * answering with the club as saved (or `answer`).
 */
function mockClub(stored: ClubDto = club, answer?: () => Response | Promise<Response>): unknown[] {
  let current = stored;
  const sent: unknown[] = [];
  server.use(
    http.get("/api/clubs/c1", () => HttpResponse.json(current)),
    http.put("/api/clubs/c1", async ({ request }) => {
      const body = (await request.json()) as Partial<ClubDto>;
      sent.push(body);
      if (answer) return answer();
      current = { ...current, ...body };
      return HttpResponse.json(current);
    }),
  );
  return sent;
}

function ClubSettings() {
  const { data } = useClub("c1");
  return data ? <SignupPhotoField club={data} /> : null;
}

const renderField = async () => {
  renderWithApp(<ClubSettings />);
  return screen.findByRole("switch", { name: "Require a photo to sign up" });
};

const toggle = () => screen.getByRole("switch", { name: "Require a photo to sign up" });

beforeEach(() => mockSignedIn(MANAGER));

describe("SignupPhotoField", () => {
  it("is off by default, saying what switching it on asks of new players", async () => {
    mockClub();
    await renderField();

    expect(toggle()).not.toBeChecked();
    expect(toggle()).toHaveAccessibleDescription(/New players signing up from the QR code must take a selfie, upload a photo or pick an avatar/);
  });

  it("saves as soon as it is switched, from anywhere on its row (a big target on a phone)", async () => {
    const sent = mockClub();
    const user = userEvent.setup();
    await renderField();

    await user.click(screen.getByText("Require a photo to sign up"));

    await waitFor(() => expect(sent).toEqual([{ requireSignupPhoto: true }]));
    expect(await screen.findByText("Photo now required")).toBeInTheDocument();
    expect(toggle()).toBeChecked();
    expect(screen.getByTestId("signup-photo-field")).toHaveClass("min-h-14");
  });

  it("switches it off again for a club that has it on", async () => {
    const sent = mockClub({ ...club, requireSignupPhoto: true });
    const user = userEvent.setup();
    expect(await renderField()).toBeChecked();

    await user.click(toggle());

    await waitFor(() => expect(sent).toEqual([{ requireSignupPhoto: false }]));
    expect(await screen.findByText("Photo now optional")).toBeInTheDocument();
  });

  it("shows the change while it saves and ignores another press meanwhile", async () => {
    const sent = mockClub(club, async () => {
      await delay(50);
      return HttpResponse.json({ ...club, requireSignupPhoto: true });
    });
    const user = userEvent.setup();
    await renderField();

    await user.click(toggle());
    expect(toggle()).toBeChecked();
    expect(toggle()).toHaveAttribute("aria-disabled", "true");
    await user.click(toggle());

    await screen.findByText("Photo now required");
    expect(sent).toHaveLength(1);
  });

  it("says why it could not be saved, and shows the club's setting as it is", async () => {
    mockClub(club, () => apiError(403, "FORBIDDEN", "You don't have permission to do that"));
    const user = userEvent.setup();
    await renderField();

    await user.click(toggle());

    expect(await screen.findByText("Could not save the photo setting")).toBeInTheDocument();
    expect(screen.getByText("You don't have permission to do that")).toBeInTheDocument();
    expect(toggle()).not.toBeChecked();
  });

  it("cannot be changed by someone who does not run the club", async () => {
    mockClub(clubDto());

    expect(await renderField()).toBeDisabled();
  });
});
