import { anteText, effectiveAnte, formatBlinds, formatChips, levelNumberAt, type ClockStructure } from "@shared/domain/clock";
import { ScrollRegion } from "@/components/shared/scroll-region";
import { cn } from "@/lib/utils";
import { structureSummary } from "../structure-form";

interface StructureTableProps {
  structure: Pick<ClockStructure, "levels" | "anteMode">;
  /** The row the clock is on, highlighted. */
  currentIndex?: number | null;
  /** What the table is, for screen readers: "Generated levels". */
  caption: string;
  className?: string;
}

/** A structure as a list of its levels and breaks: the generator's preview, and the clock for those who cannot edit it. */
export function StructureTable({ structure, currentIndex = null, caption, className }: StructureTableProps) {
  const { levels, anteMode } = structure;
  const antes = anteMode !== "none" && levels.some((level) => effectiveAnte(level, anteMode) > 0);
  return (
    <ScrollRegion label={caption} className={cn("max-h-96 overflow-auto rounded-md border border-border", className)}>
      <table className="w-full text-sm tabular-nums">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-muted text-left text-xs font-semibold text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2">
              Level
            </th>
            <th scope="col" className="px-3 py-2">
              Blinds
            </th>
            {antes ? (
              <th scope="col" className="px-3 py-2">
                {anteMode === "bb_ante" ? "BB ante" : "Ante"}
              </th>
            ) : null}
            <th scope="col" className="px-3 py-2 text-right">
              Minutes
            </th>
          </tr>
        </thead>
        <tbody>
          {levels.map((level, index) => (
            <tr key={level.id} className={cn("border-t border-border", index === currentIndex && "bg-primary/10 font-semibold", level.kind === "break" && "text-muted-foreground")}>
              <th scope="row" className="px-3 py-1.5 text-left font-medium text-foreground">
                {level.kind === "break" ? "Break" : levelNumberAt(levels, index)}
                {index === currentIndex ? <span className="ml-2 text-xs text-primary">now</span> : null}
              </th>
              <td className="px-3 py-1.5 text-foreground">{level.kind === "break" ? (level.note ?? "") : formatBlinds(level)}</td>
              {antes ? <td className="px-3 py-1.5">{anteText(level, anteMode) ? formatChips(effectiveAnte(level, anteMode)) : ""}</td> : null}
              <td className="px-3 py-1.5 text-right">{level.durationMinutes}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
        {structureSummary(levels)}
      </p>
    </ScrollRegion>
  );
}
