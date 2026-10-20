import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { USER_ROLES, type AdminUserRow } from "@shared/api/admin";
import { server } from "@test/msw/server";
import { accountRow, playerRow, sessionUser } from "@test/helpers/f5-dto";
import { apiError, mockSignedIn, renderWithApp } from "@test/helpers/web";
import { pageNavigation } from "@/lib/page-navigation";
import { roleLabel } from "../roles";
import UserManagementPage from "./user-management";

const ADMIN = { id: "a1", name: "Ada Admin", email: "ada@lovepoker.test", role: "admin" } as const;

const ada = accountRow({ id: "a1", name: "Ada Admin", email: "ada@lovepoker.test", role: "admin" });
const olly = accountRow({ id: "u2", name: "Olly Owner", email: "olly@club.test" });
const dora = accountRow({ id: "u3", name: "Dora Disabled", email: "dora@club.test", isActive: false });
const aroha = playerRow({ id: "p1", name: "Aroha Smith" });

/** GET /api/admin/users answering `rows()`, counting how often it was asked. */
function serveUsers(rows: () => AdminUserRow[]) {
  const calls = { count: 0 };
  server.use(
    http.get("/api/admin/users", () => {
      calls.count += 1;
      return HttpResponse.json(rows());
    }),
  );
  return calls;
}

const rowOf = (name: string) => screen.getByRole("cell", { name }).closest("tr") as HTMLElement;

afterEach(() => vi.restoreAllMocks());

describe("User management", () => {
  it("lists accounts and club members with their type, role, status and last sign-in", async () => {
    mockSignedIn(ADMIN);
    serveUsers(() => [ada, olly, dora, aroha]);
    renderWithApp(<UserManagementPage />, { path: "/users" });

    expect(await screen.findByRole("cell", { name: "Olly Owner" })).toBeInTheDocument();
    expect(within(rowOf("Olly Owner")).getByText("Full Member")).toBeInTheDocument();
    expect(within(rowOf("Olly Owner")).getByText("1 Oct 2026")).toBeInTheDocument();
    expect(within(rowOf("Dora Disabled")).getByText("Disabled")).toBeInTheDocument();
    // A club member's type and role both read "Club Member".
    expect(within(rowOf("Aroha Smith")).getAllByText("Club Member")).toHaveLength(2);
    expect(within(rowOf("Aroha Smith")).getByText("N/A")).toBeInTheDocument();
  });

  it("offers View as only for active accounts that are neither admins nor the admin themselves", async () => {
    mockSignedIn(ADMIN);
    serveUsers(() => [ada, olly, dora, aroha]);
    renderWithApp(<UserManagementPage />, { path: "/users" });

    expect(await screen.findByRole("button", { name: "View as Olly Owner" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View as Ada Admin" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View as Dora Disabled" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View as Aroha Smith" })).not.toBeInTheDocument();
  });

  it("narrows the list by search, type and role", async () => {
    mockSignedIn(ADMIN);
    serveUsers(() => [ada, olly, dora, aroha]);
    renderWithApp(<UserManagementPage />, { path: "/users" });

    await userEvent.type(await screen.findByLabelText("Search"), "olly@");
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(rowOf("Olly Owner")).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Search"));
    await userEvent.click(screen.getByRole("combobox", { name: "Type" }));
    await userEvent.click(screen.getByRole("option", { name: "Club Members" }));
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(rowOf("Aroha Smith")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "Role" }));
    await userEvent.click(screen.getByRole("option", { name: "Admin" }));
    expect(screen.getByRole("heading", { name: "No users found" })).toBeInTheDocument();
  });

  it("says when the list could not be loaded", async () => {
    mockSignedIn(ADMIN);
    server.use(http.get("/api/admin/users", () => apiError(403, "FORBIDDEN", "Admins only")));
    renderWithApp(<UserManagementPage />, { path: "/users" });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Users could not be loaded");
    expect(alert).toHaveTextContent("Admins only");
  });
});

describe("User management: editing", () => {
  it("saves an account's details, role and status, and refreshes the list", async () => {
    mockSignedIn(ADMIN);
    let saved = olly;
    const calls = serveUsers(() => [ada, saved]);
    let body: unknown;
    server.use(
      http.put("/api/admin/users/:id", async ({ request }) => {
        body = await request.json();
        saved = { ...olly, role: "admin", phone: "021 555 0199" };
        return HttpResponse.json({ message: "User updated successfully", user: sessionUser({ id: "u2", name: "Olly Owner", role: "admin" }) });
      }),
    );
    renderWithApp(<UserManagementPage />, { path: "/users" });

    await userEvent.click(await screen.findByRole("button", { name: "Edit Olly Owner" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit User" });
    await userEvent.type(within(dialog).getByLabelText("Phone"), "021 555 0199");
    await userEvent.click(within(dialog).getByRole("combobox", { name: "Role" }));
    await userEvent.click(screen.getByRole("option", { name: "Admin" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText("User has been updated successfully.")).toBeInTheDocument();
    expect(body).toEqual({ name: "Olly Owner", email: "olly@club.test", phone: "021 555 0199", role: "admin", isActive: true });
    await waitFor(() => expect(calls.count).toBe(2));
    expect(screen.queryByRole("dialog", { name: "Edit User" })).not.toBeInTheDocument();
  });

  it("offers every account role, named as the list names it, in the role filter and the edit dialog alike (P3REV6-CQ-08)", async () => {
    mockSignedIn(ADMIN);
    serveUsers(() => [ada, olly]);
    renderWithApp(<UserManagementPage />, { path: "/users" });
    const optionNames = () => screen.getAllByRole("option").map((option) => option.textContent);
    const labels = USER_ROLES.map(roleLabel);

    await userEvent.click(await screen.findByRole("combobox", { name: "Role" }));
    expect(optionNames()).toEqual(["All Roles", ...labels]);
    await userEvent.keyboard("{Escape}");

    await userEvent.click(await screen.findByRole("button", { name: "Edit Olly Owner" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit User" });
    await userEvent.click(within(dialog).getByRole("combobox", { name: "Role" }));
    expect(optionNames()).toEqual(labels);
  });

  it("does not offer, or send, an admin's own role and status", async () => {
    mockSignedIn(ADMIN);
    serveUsers(() => [ada]);
    let body: unknown;
    server.use(
      http.put("/api/admin/users/:id", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ message: "User updated successfully", user: sessionUser({ id: "a1", name: "Ada Admin", role: "admin" }) });
      }),
    );
    renderWithApp(<UserManagementPage />, { path: "/users" });

    await userEvent.click(await screen.findByRole("button", { name: "Edit Ada Admin" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit User" });
    expect(within(dialog).getByText("You can't change your own role or status. Another admin can.")).toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(body).toEqual({ name: "Ada Admin", email: "ada@lovepoker.test", phone: null }));
  });

  it("puts a taken email under the email field, and keeps the dialog open for a refusal like the last admin", async () => {
    mockSignedIn(ADMIN);
    serveUsers(() => [ada, olly]);
    let answer = apiError(409, "EMAIL_TAKEN", "An account with that email already exists");
    server.use(http.put("/api/admin/users/:id", () => answer));
    renderWithApp(<UserManagementPage />, { path: "/users" });

    await userEvent.click(await screen.findByRole("button", { name: "Edit Olly Owner" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit User" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }));
    expect(await within(dialog).findByText("An account with that email already exists")).toBeInTheDocument();

    answer = apiError(409, "LAST_ADMIN", "There must always be at least one active admin");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }));
    expect(await screen.findByText("There must always be at least one active admin")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Edit User" })).toBeInTheDocument();
  });

  it("edits a club member as the player they are, never touching their photo (CA-23)", async () => {
    mockSignedIn(ADMIN);
    const calls = serveUsers(() => [aroha]);
    let body: unknown;
    let usersEndpointCalled = false;
    server.use(
      http.put("/api/players/:id", async ({ request, params }) => {
        body = await request.json();
        expect(params.id).toBe("p1");
        return HttpResponse.json({ id: "p1", name: "Aroha Smith-Jones", email: "aroha@example.com", phone: null, imageUrl: null, createdAt: null });
      }),
      http.put("/api/admin/users/:id", () => {
        usersEndpointCalled = true;
        return apiError(404, "NOT_FOUND", "User not found");
      }),
    );
    renderWithApp(<UserManagementPage />, { path: "/users" });

    await userEvent.click(await screen.findByRole("button", { name: "Edit Aroha Smith" }));
    const sheet = await screen.findByRole("dialog", { name: "Edit Player" });
    expect(within(sheet).queryByRole("group", { name: "Player Photo" })).not.toBeInTheDocument();
    await userEvent.type(within(sheet).getByLabelText("Player Name*"), "-Jones");
    await userEvent.clear(within(sheet).getByLabelText("Phone Number"));
    await userEvent.click(within(sheet).getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(body).toEqual({ name: "Aroha Smith-Jones", email: "aroha@example.com", phone: null }));
    expect(usersEndpointCalled).toBe(false);
    await waitFor(() => expect(calls.count).toBe(2));
  });
});

describe("User management: viewing as someone else", () => {
  it("starts the impersonation and opens the app afresh on the staff home page", async () => {
    mockSignedIn(ADMIN);
    serveUsers(() => [ada, olly]);
    const assign = vi.spyOn(pageNavigation, "assign").mockImplementation(() => {});
    let impersonated = "";
    server.use(
      http.post("/api/admin/users/:id/impersonate", ({ params }) => {
        impersonated = String(params.id);
        return HttpResponse.json({ message: "Now impersonating", user: sessionUser({ id: "u2", name: "Olly Owner" }) });
      }),
    );
    renderWithApp(<UserManagementPage />, { path: "/users" });

    await userEvent.click(await screen.findByRole("button", { name: "View as Olly Owner" }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/dashboard"));
    expect(impersonated).toBe("u2");
  });

  it("says why when the server refuses", async () => {
    mockSignedIn(ADMIN);
    serveUsers(() => [ada, olly]);
    const assign = vi.spyOn(pageNavigation, "assign").mockImplementation(() => {});
    server.use(http.post("/api/admin/users/:id/impersonate", () => apiError(409, "USER_INACTIVE", "That account is disabled")));
    renderWithApp(<UserManagementPage />, { path: "/users" });

    await userEvent.click(await screen.findByRole("button", { name: "View as Olly Owner" }));

    expect(await screen.findByText("Impersonation failed")).toBeInTheDocument();
    expect(screen.getByText("That account is disabled")).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });
});
