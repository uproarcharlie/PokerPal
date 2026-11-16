import { describe, expect, it } from "vitest";
import { normaliseNzBankAccount } from "@shared/api/clubs";
import { formatBankAccountInput } from "./bank-account";

describe("formatBankAccountInput (round 8)", () => {
  it.each([
    ["", ""],
    ["1", "1"],
    ["12", "12"],
    ["123", "12-3"],
    ["123456", "12-3456"],
    ["1234567", "12-3456-7"],
    ["1234567890123", "12-3456-7890123"],
    ["12345678901230", "12-3456-7890123-0"],
    ["123456789012300", "12-3456-7890123-00"],
    ["1234567890123001", "12-3456-7890123-001"],
  ])("lays %j out as %j while it is typed", (typed, shown) => {
    expect(formatBankAccountInput(typed)).toBe(shown);
  });

  it("drops what is not a digit, so a pasted number with spaces or dashes reads the same", () => {
    expect(formatBankAccountInput("12 3456 7890123 00")).toBe("12-3456-7890123-00");
    expect(formatBankAccountInput("12-3456-7890123-00")).toBe("12-3456-7890123-00");
    expect(formatBankAccountInput("Acc: 12.3456.7890123.00")).toBe("12-3456-7890123-00");
  });

  it("stops at the longest account number (16 digits)", () => {
    expect(formatBankAccountInput("12345678901230019")).toBe("12-3456-7890123-001");
  });

  it("drops a dash left at the end, so backspacing from \"12-3\" leaves \"12\"", () => {
    expect(formatBankAccountInput("12-")).toBe("12");
  });

  it("gives every whole number exactly as the server stores it (normaliseNzBankAccount)", () => {
    for (const digits of ["123456789012300", "0212345678901001"]) {
      expect(formatBankAccountInput(digits)).toBe(normaliseNzBankAccount(digits));
    }
  });
});
