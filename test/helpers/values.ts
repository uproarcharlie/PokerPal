/** A well-formed uuid that no factory or API call ever creates: use it for "unknown id" cases. */
export const UNKNOWN_ID = "00000000-0000-0000-0000-000000000000";

/** A row as the API serialises it: Dates become ISO strings, undefined fields disappear. */
export const asJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
