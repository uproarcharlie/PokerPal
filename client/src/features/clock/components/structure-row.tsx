import type { FieldErrors, UseFormRegister } from "react-hook-form";
import { ArrowDown, ArrowUp, MoreVertical, Plus, Trash2 } from "lucide-react";
import type { AnteMode } from "@shared/domain/clock";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { LevelRowValues, StructureFormValues } from "../structure-form";

/**
 * The editor's box columns: small blind, big blind, ante (none while the structure has no antes) and
 * minutes. A row's name and menu sit above its boxes on a phone and beside them from `sm`, in a
 * NAME_COLUMN as wide on every row, so the column headings line up with every row's boxes.
 */
export const boxGrid = (anteMode: AnteMode) => cn("grid min-w-0 flex-1 gap-1.5 sm:gap-2", anteMode === "none" ? "grid-cols-3" : "grid-cols-4");
export const NAME_COLUMN = "sm:w-36 sm:shrink-0";

export interface RowActions {
  insertLevel: () => void;
  insertBreak: () => void;
  moveUp?: () => void;
  moveDown?: () => void;
  /** Undefined when the row cannot be deleted (the clock is on it), with the reason. */
  remove?: () => void;
  keptBecause?: string;
}

interface StructureRowProps {
  index: number;
  kind: LevelRowValues["kind"];
  /** "Level 3" or "Break 1". */
  title: string;
  anteMode: AnteMode;
  register: UseFormRegister<StructureFormValues>;
  errors: FieldErrors<StructureFormValues>["levels"];
  current: boolean;
  actions: RowActions;
}

const BOX = "h-9 px-2 tabular-nums";

/** One level or break of the structure editor: its boxes, its problems, and a menu to insert, move or delete. */
export function StructureRow({ index, kind, title, anteMode, register, errors, current, actions }: StructureRowProps) {
  const rowErrors = errors?.[index];
  const problems = rowErrors
    ? [rowErrors.smallBlind, rowErrors.bigBlind, rowErrors.ante, rowErrors.durationMinutes, rowErrors.note].flatMap((error) => (error?.message ? [error.message] : []))
    : [];
  const describedBy = problems.length > 0 ? `level-row-${String(index)}-problems` : undefined;
  const box = (field: "smallBlind" | "bigBlind" | "ante" | "durationMinutes", label: string) => (
    <Input
      inputMode="numeric"
      aria-label={`${title} ${label}`}
      aria-invalid={rowErrors?.[field] ? true : undefined}
      aria-describedby={describedBy}
      className={BOX}
      {...register(`levels.${index}.${field}`)}
    />
  );

  return (
    <li className={cn("rounded-md border border-transparent px-1 py-1.5", current && "border-primary bg-primary/5", kind === "break" && "bg-muted/60")} data-testid={`level-row-${String(index)}`}>
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-2">
        <div className={cn("flex h-9 items-center justify-between gap-2", NAME_COLUMN)}>
          <span className="text-sm font-semibold text-foreground">{title}</span>
          {current ? <span className="mr-auto text-xs font-medium text-primary">now</span> : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="h-9 w-10" aria-label={`More for ${title}`}>
                <MoreVertical aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={actions.insertLevel}>
                <Plus aria-hidden="true" />
                Insert a level below
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={actions.insertBreak}>
                <Plus aria-hidden="true" />
                Insert a break below
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={actions.moveUp} disabled={!actions.moveUp}>
                <ArrowUp aria-hidden="true" />
                Move up
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={actions.moveDown} disabled={!actions.moveDown}>
                <ArrowDown aria-hidden="true" />
                Move down
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={actions.remove} disabled={!actions.remove} className="text-destructive">
                <Trash2 aria-hidden="true" />
                {actions.remove ? "Delete" : (actions.keptBecause ?? "Delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className={boxGrid(anteMode)}>
          {kind === "level" ? (
            <>
              {box("smallBlind", "small blind")}
              {box("bigBlind", "big blind")}
              {anteMode !== "none" ? box("ante", anteMode === "bb_ante" ? "big blind ante" : "ante") : null}
            </>
          ) : (
            <Input
              aria-label={`${title} note`}
              placeholder="Note, e.g. Colour up"
              aria-invalid={rowErrors?.note ? true : undefined}
              aria-describedby={describedBy}
              className={cn(BOX, anteMode === "none" ? "col-span-2" : "col-span-3")}
              {...register(`levels.${index}.note`)}
            />
          )}
          {box("durationMinutes", "minutes")}
        </div>
      </div>
      {problems.length > 0 ? (
        <p id={describedBy} className="mt-1 text-sm font-medium text-destructive sm:pl-[9.5rem]">
          {problems.join(" · ")}
        </p>
      ) : null}
    </li>
  );
}
