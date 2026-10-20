import type { Key, ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { PHONE_QUERY, useMediaQuery } from "./use-media-query";

export interface ResponsiveColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /**
   * On a phone each row is a card: `title` columns head it, `detail` columns are listed under their
   * header, `actions` columns (buttons, menus) close it without a header, `hidden` ones are left out.
   * Default `detail`.
   */
  phone?: "title" | "detail" | "actions" | "hidden";
  /** Classes for this column's header and cells on wider screens, e.g. "text-right". */
  className?: string;
}

/** Attributes for a row's element (the table row, or the card on a phone). */
export interface ResponsiveRowProps {
  "data-testid"?: string;
}

interface ResponsiveTableProps<T> {
  rows: readonly T[];
  columns: readonly ResponsiveColumn<T>[];
  rowKey: (row: T) => Key;
  rowProps?: (row: T) => ResponsiveRowProps;
  /** Names the table for screen readers. */
  caption: string;
  /**
   * The level of each phone card's heading (its `title` columns), so a screen reader can move from
   * card to card: one below the heading the list sits under. Default 3.
   */
  titleLevel?: 2 | 3 | 4;
  className?: string;
}

/**
 * One list of rows shown as a table from tablet width and as cards on a phone. Only one of the two is
 * ever in the page, so row test ids and accessible names are never duplicated.
 */
export function ResponsiveTable<T>({ rows, columns, rowKey, rowProps, caption, titleLevel = 3, className }: ResponsiveTableProps<T>) {
  const phone = useMediaQuery(PHONE_QUERY);

  if (phone) {
    const titles = columns.filter((column) => column.phone === "title");
    const details = columns.filter((column) => (column.phone ?? "detail") === "detail");
    const actions = columns.filter((column) => column.phone === "actions");
    const Title = `h${titleLevel}` as const;
    // role="list": Tailwind takes the markers off, and Safari then no longer calls it a list (P3REV-MA-VO-LISTS).
    return (
      <ul role="list" aria-label={caption} className={cn("space-y-3", className)}>
        {rows.map((row) => (
          <li key={rowKey(row)} className="rounded-lg border bg-card p-4 text-card-foreground" {...rowProps?.(row)}>
            {titles.length > 0 ? (
              <Title className="mb-2 flex flex-wrap items-center gap-2 text-base font-medium text-foreground">
                {titles.map((column) => (
                  <span key={column.id}>{column.cell(row)}</span>
                ))}
              </Title>
            ) : null}
            {/* minmax(0, 1fr): a long value wraps inside the card instead of widening it past the screen (MA-REV-01). */}
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
              {details.map((column) => (
                <div key={column.id} className="contents">
                  <dt className="text-muted-foreground">{column.header}</dt>
                  <dd className="min-w-0 break-words text-right">{column.cell(row)}</dd>
                </div>
              ))}
            </dl>
            {actions.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                {actions.map((column) => (
                  <div key={column.id}>{column.cell(row)}</div>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Table className={className}>
      <caption className="sr-only">{caption}</caption>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column.id} className={column.className}>
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={rowKey(row)} {...rowProps?.(row)}>
            {columns.map((column) => (
              <TableCell key={column.id} className={column.className}>
                {column.cell(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
