import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FIELD_CLASS, Input } from "./input";
import { NativeSelect } from "./native-select";

describe("NativeSelect (P3REV3-CQ-10)", () => {
  it("is drawn like the text boxes: the same edge, focus ring and disabled look", () => {
    render(
      <>
        <Input aria-label="Name" />
        <NativeSelect aria-label="Season" className="sm:max-w-sm">
          <option>Spring</option>
        </NativeSelect>
      </>,
    );
    const shared = FIELD_CLASS.split(" ");

    expect(screen.getByRole("textbox", { name: "Name" })).toHaveClass(...shared);
    expect(screen.getByRole("combobox", { name: "Season" })).toHaveClass(...shared, "sm:max-w-sm");
    expect(shared).toEqual(expect.arrayContaining(["focus-visible:ring-2", "focus-visible:ring-offset-2", "disabled:opacity-50"]));
  });
});
