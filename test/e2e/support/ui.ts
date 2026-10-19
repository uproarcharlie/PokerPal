import { expect, type Locator, type Page } from "@playwright/test";
import type { Account } from "./api";

/** Picks an option of a Radix Select (a string names it exactly): opens it, then clicks the option in its portal. */
export async function choose(page: Page, trigger: Locator, option: string | RegExp): Promise<void> {
  await trigger.click();
  await page.getByRole("option", { name: option, exact: typeof option === "string" }).click();
  await expect(page.getByRole("listbox")).toBeHidden();
}

/** Signs in through the login page, which lands on the clubs page. */
export async function signInThroughUi(page: Page, account: Pick<Account, "email" | "password">): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByRole("heading", { name: "Club Management" })).toBeVisible();
}

/** A toast with this text (title or description). */
export function toast(page: Page, text: string | RegExp): Locator {
  return page.locator("li[role=status]").filter({ hasText: text });
}

/** The table on the page with this column heading. */
export function tableWithColumn(page: Page, heading: string): Locator {
  return page.locator("table").filter({ has: page.getByRole("columnheader", { name: heading, exact: true }) });
}

/** The cells of each body row of `table`, as they read on screen (innerText, whitespace collapsed). */
export async function tableRows(table: Locator): Promise<string[][]> {
  await expect(table.locator("tbody tr").first()).toBeVisible();
  return table.locator("tbody tr").evaluateAll((rows) =>
    rows.map((row) =>
      Array.from(row.querySelectorAll("td"), (cell) => (cell as HTMLElement).innerText.replace(/\s+/g, " ").trim()),
    ),
  );
}
