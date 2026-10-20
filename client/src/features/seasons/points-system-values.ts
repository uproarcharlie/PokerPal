/**
 * The points-system form's values as its boxes hold them (text: whole numbers are typed into text
 * boxes, lib/forms `readNumber`), and the schema that reads them into the shared
 * createPointsSystemSchema's numbers and checks them.
 */
import { z } from "zod";
import { createPointsSystemSchema } from "@shared/api/points";
import { readNumber, readOptionalNumber } from "@/lib/forms";

export interface AllocationFormValues {
  position: string;
  /** The last position of a range ("4th to 10th"); blank for a single position. */
  positionEnd: string;
  points: string;
  description: string;
}

export interface PointsSystemFormValues {
  name: string;
  description: string;
  participationPoints: string;
  knockoutPoints: string;
  allocations: AllocationFormValues[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** The boxes' text as numbers: a blank optional total is left out, a blank range end is none (null). */
function numbersOf(values: unknown): unknown {
  if (!isRecord(values)) return values;
  return {
    ...values,
    participationPoints: readOptionalNumber(values.participationPoints),
    knockoutPoints: readOptionalNumber(values.knockoutPoints),
    allocations: Array.isArray(values.allocations)
      ? values.allocations.map((row: unknown) =>
          isRecord(row) ? { ...row, position: readNumber(row.position), positionEnd: readNumber(row.positionEnd), points: readNumber(row.points) } : row,
        )
      : values.allocations,
  };
}

export const pointsSystemFormSchema = z.preprocess(numbersOf, createPointsSystemSchema);

export const EMPTY_ALLOCATION: AllocationFormValues = { position: "", positionEnd: "", points: "", description: "" };

export const EMPTY_POINTS_SYSTEM: PointsSystemFormValues = {
  name: "",
  description: "",
  participationPoints: "0",
  knockoutPoints: "0",
  allocations: [],
};

const SYSTEM_FIELDS: ReadonlySet<string> = new Set<keyof PointsSystemFormValues>([
  "name",
  "description",
  "participationPoints",
  "knockoutPoints",
]);
const ALLOCATION_FIELD = /^allocations\.(\d+)\.(position|positionEnd|points|description)$/;

/** Whether a server VALIDATION problem's path ("allocations.1.position") names a field of a form with `rows` rows. */
export function isPointsSystemField(name: string, rows: number): boolean {
  if (SYSTEM_FIELDS.has(name)) return true;
  const match = ALLOCATION_FIELD.exec(name);
  return match !== null && Number(match[1]) < rows;
}
