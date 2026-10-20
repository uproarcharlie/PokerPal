import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ResponsiveTable, type ResponsiveColumn } from "./responsive-table";

interface Row {
  id: string;
  name: string;
  owed: string;
  note: string;
}

const rows: Row[] = [
  { id: "r1", name: "Alice", owed: "$50", note: "regular" },
  { id: "r2", name: "Bob", owed: "$75", note: "new" },
];
const columns: ResponsiveColumn<Row>[] = [
  { id: "name", header: "Player", cell: (row) => row.name, phone: "title" },
  { id: "owed", header: "Owed", cell: (row) => row.owed, className: "text-right" },
  { id: "note", header: "Note", cell: (row) => row.note, phone: "hidden" },
];

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

function asPhone(phone: boolean) {
  window.matchMedia = (query: string) => ({ ...originalMatchMedia(query), matches: phone && query.includes("max-width") });
}

describe("ResponsiveTable", () => {
  it("is a table from tablet width", () => {
    asPhone(false);
    render(<ResponsiveTable rows={rows} columns={columns} rowKey={(row) => row.id} caption="Players to pay" />);

    const table = screen.getByRole("table", { name: "Players to pay" });
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Player", "Owed", "Note"]);
    expect(within(table).getAllByRole("row")).toHaveLength(3);
  });

  it("is a list of cards on a phone, with only one copy of each row in the page", () => {
    asPhone(true);
    render(<ResponsiveTable rows={rows} columns={columns} rowKey={(row) => row.id} caption="Players to pay" />);

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const cards = within(screen.getByRole("list", { name: "Players to pay" })).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("Alice");
    expect(within(cards[0]).getByText("Owed")).toBeInTheDocument();
    expect(cards[0]).not.toHaveTextContent("regular");
    expect(screen.getAllByText("Alice")).toHaveLength(1);
  });

  it("says it is a list and heads each card, so VoiceOver counts the cards and moves between them (P3REV-MA-VO-LISTS)", () => {
    asPhone(true);
    const { rerender } = render(<ResponsiveTable rows={rows} columns={columns} rowKey={(row) => row.id} caption="Players to pay" />);

    // Safari ignores a list without markers unless it has the role written on it.
    expect(screen.getByRole("list", { name: "Players to pay" })).toHaveAttribute("role", "list");
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["Alice", "Bob"]);

    rerender(<ResponsiveTable rows={rows} columns={columns} rowKey={(row) => row.id} caption="Players to pay" titleLevel={4} />);
    expect(screen.getAllByRole("heading", { level: 4 })).toHaveLength(2);
  });

  it("puts each row's test id on its table row, or on its card on a phone, and closes a card with its actions", () => {
    const withActions: ResponsiveColumn<Row>[] = [...columns, { id: "act", header: "Actions", phone: "actions", cell: (row) => <button>Pay {row.name}</button> }];
    const renderList = () => (
      <ResponsiveTable rows={rows} columns={withActions} rowKey={(row) => row.id} rowProps={(row) => ({ "data-testid": `row-${row.id}` })} caption="Players to pay" />
    );

    asPhone(false);
    const { unmount } = render(renderList());
    expect(screen.getByTestId("row-r1").tagName).toBe("TR");
    expect(screen.getByTestId("row-r1")).toHaveTextContent("Alice");
    unmount();

    asPhone(true);
    render(renderList());
    const card = screen.getByTestId("row-r2");
    expect(card.tagName).toBe("LI");
    expect(within(card).getByRole("button", { name: "Pay Bob" })).toBeInTheDocument();
    expect(within(card).queryByText("Actions")).not.toBeInTheDocument();
  });
});
