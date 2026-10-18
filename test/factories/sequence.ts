let counter = 0;

/** A short token that is unique within this process, for emails, slugs and names. */
export function uniqueSuffix(): string {
  counter += 1;
  return `${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
