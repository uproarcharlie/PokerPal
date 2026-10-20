import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MoneyText } from "./money-text";

describe("MoneyText", () => {
  it("formats cents and decimal columns with shared/domain's rule", () => {
    render(
      <>
        <MoneyText cents={47500} />
        <MoneyText amount="100.65" />
        <MoneyText amount="25.00" forceCents />
      </>,
    );

    expect(screen.getByText("$475")).toHaveClass("tabular-nums");
    expect(screen.getByText("$100.65")).toBeInTheDocument();
    expect(screen.getByText("$25.00")).toBeInTheDocument();
  });
});
