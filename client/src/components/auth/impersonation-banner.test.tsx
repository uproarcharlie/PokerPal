import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@test/msw/server";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import { pageNavigation } from "@/lib/page-navigation";
import { ImpersonationBanner } from "./impersonation-banner";

const TD = { id: "u1", name: "Tess TD", email: "tess@club.test", role: "full_member" } as const;
const ADMIN = { id: "a1", name: "Ada Admin", email: "ada@lovepoker.test" };

describe("ImpersonationBanner", () => {
  beforeEach(() => {
    vi.spyOn(pageNavigation, "reload").mockImplementation(() => {});
    vi.spyOn(pageNavigation, "assign").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is not shown to someone signed in as themselves", async () => {
    mockSignedIn(TD);
    renderWithApp(
      <>
        <p>Page</p>
        <ImpersonationBanner />
      </>,
    );

    expect(await screen.findByText("Page")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("status", { name: "Impersonation" })).not.toBeInTheDocument());
  });

  it("shows whose view this is on any page, and Exit reloads the app as the admin (SEC-13)", async () => {
    mockSignedIn(TD, { impersonator: ADMIN });
    const stopped = vi.fn();
    server.use(
      http.post("/api/admin/stop-impersonation", () => {
        stopped();
        return HttpResponse.json({ message: "Impersonation ended", user: ADMIN });
      }),
    );
    renderWithApp(<ImpersonationBanner />);

    const banner = await screen.findByRole("status", { name: "Impersonation" });
    expect(banner).toHaveTextContent("Viewing as Tess TD (you are Ada Admin)");
    await userEvent.click(screen.getByRole("button", { name: "Exit" }));

    await waitFor(() => expect(pageNavigation.reload).toHaveBeenCalledOnce());
    expect(stopped).toHaveBeenCalledOnce();
  });

  it("sends the admin to sign in when their own admin access has ended meanwhile", async () => {
    mockSignedIn(TD, { impersonator: ADMIN });
    server.use(
      http.post("/api/admin/stop-impersonation", () => apiError(401, "UNAUTHENTICATED", "Your admin access has ended. Please sign in again.")),
    );
    renderWithApp(<ImpersonationBanner />);

    await userEvent.click(await screen.findByRole("button", { name: "Exit" }));

    await waitFor(() => expect(pageNavigation.assign).toHaveBeenCalledWith("/login"));
    expect(screen.queryByRole("status", { name: "Impersonation" })).not.toBeInTheDocument();
    expect(pageNavigation.reload).not.toHaveBeenCalled();
  });

  it("keeps the banner and says why when the server refuses", async () => {
    mockSignedIn(TD, { impersonator: ADMIN });
    server.use(http.post("/api/admin/stop-impersonation", () => apiError(400, "NOT_IMPERSONATING", "Not currently impersonating")));
    renderWithApp(<ImpersonationBanner />);

    await userEvent.click(await screen.findByRole("button", { name: "Exit" }));

    expect(await screen.findByText("Not currently impersonating")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Impersonation" })).toHaveTextContent("Viewing as Tess TD");
    expect(pageNavigation.reload).not.toHaveBeenCalled();
  });
});
