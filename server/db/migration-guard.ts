/**
 * Mechanical safety net for `migrations/*.sql`. Production data must persist, so
 * a migration may only add things, and every statement must be safe to run
 * again (a file re-runs when it is edited, or after a no-transaction file
 * fails part-way). This is an allowlist: each statement must be one of
 *
 * - `CREATE TABLE IF NOT EXISTS` (inline constraints allowed);
 * - `CREATE [UNIQUE] INDEX [CONCURRENTLY] IF NOT EXISTS <name>`, UNIQUE only on
 *   a (non-temporary) table created earlier in the same file. That is only a
 *   first check: `CREATE TABLE IF NOT EXISTS` does nothing when the table
 *   already exists, so the runner also refuses, against the live database, a
 *   UNIQUE index on any table that existed before the run (any older table may
 *   hold duplicates, and its deployed code may write them);
 * - `ALTER TABLE … ADD [COLUMN] IF NOT EXISTS`, without constraints, and
 *   without a DEFAULT, or with a constant one (or now(), when nullable): NOT
 *   NULL needs a constant DEFAULT. Anything Postgres would compute per row (a
 *   volatile DEFAULT such as gen_random_uuid(), serial, identity and generated
 *   columns) is refused: filling existing rows rewrites the whole table under
 *   an exclusive lock, stalling the live site;
 * - `ALTER TYPE … ADD VALUE IF NOT EXISTS`;
 * - `CREATE EXTENSION | SCHEMA | SEQUENCE IF NOT EXISTS`;
 * - `CREATE TYPE` / `CREATE DOMAIN`, which have no IF NOT EXISTS, only as
 *   `DO $$ BEGIN CREATE TYPE …; EXCEPTION WHEN duplicate_object THEN NULL; END $$`;
 * - `INSERT INTO t (<columns>) … ON CONFLICT (<unique columns it supplies>) DO NOTHING`,
 *   with fixed values, or `INSERT INTO t … WHERE NOT EXISTS (SELECT … FROM t …)`;
 * - `COMMENT ON …`.
 *
 * Anything else (functions, triggers, rules, policies, grants, other DO blocks,
 * SELECT, SET, …) is refused, and destructive keywords (DROP, TRUNCATE, DELETE
 * FROM, UPDATE … SET, …) are refused anywhere. SET and RESET are refused
 * because the runner owns the session: its lock_timeout (5s) and
 * statement_timeout (60s) stop a migration from stalling the live site behind
 * a lock. The checks are purely syntactic and deliberately conservative: a
 * false positive costs a rewrite, a false negative could cost real data. They
 * catch mistakes, not malice: SQL built at run time cannot be checked by
 * reading it, which is why the forms that run code are refused outright. There
 * is no override; anything refused needs sign-off and a hand-run plan.
 */

export interface SqlStatement {
  /** 1-based line where the statement starts in its file. */
  line: number;
  /** Executable text: the statement with comments removed. */
  sql: string;
  /**
   * What the guard inspects: comments removed, top-level string literals
   * emptied (so data such as `DEFAULT 'drop-in'` cannot trip a rule) and
   * whitespace collapsed. Dollar-quoted bodies are kept verbatim because they
   * contain executable SQL. A single-quoted literal is only ever code as the
   * body of DO or CREATE FUNCTION/PROCEDURE, and the guard refuses those forms.
   */
  scan: string;
}

export interface GuardViolation {
  line: number;
  rule: string;
  excerpt: string;
}

export class SqlParseError extends Error {
  constructor(message: string, readonly line: number) {
    super(`${message} (line ${line})`);
    this.name = "SqlParseError";
  }
}

const IDENT_CHAR = /[A-Za-z0-9_$]/;
const DOLLAR_TAG = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/;

function lineAt(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (source[i] === "\n") line++;
  return line;
}

function endOfBlockComment(source: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < source.length) {
    if (source.startsWith("/*", i)) {
      depth++;
      i += 2;
    } else if (source.startsWith("*/", i)) {
      depth--;
      i += 2;
      if (depth === 0) return i;
    } else {
      i++;
    }
  }
  throw new SqlParseError("Unterminated block comment", lineAt(source, start));
}

function endOfStringLiteral(source: string, start: number): number {
  // E'...' strings honour backslash escapes; standard strings only escape '' (standard_conforming_strings).
  const prefix = source[start - 1];
  const backslashEscapes = (prefix === "E" || prefix === "e") && !IDENT_CHAR.test(source[start - 2] ?? "");
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i];
    if (backslashEscapes && ch === "\\") {
      i += 2;
    } else if (ch === "'") {
      if (source[i + 1] !== "'") return i + 1;
      i += 2;
    } else {
      i++;
    }
  }
  throw new SqlParseError("Unterminated string literal", lineAt(source, start));
}

function endOfQuotedIdentifier(source: string, start: number): number {
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === '"') {
      if (source[i + 1] !== '"') return i + 1;
      i += 2;
    } else {
      i++;
    }
  }
  throw new SqlParseError("Unterminated quoted identifier", lineAt(source, start));
}

/**
 * Split a SQL file into statements on top-level semicolons, respecting
 * comments, string literals, quoted identifiers and dollar quoting.
 */
export function splitSqlStatements(source: string): SqlStatement[] {
  const statements: SqlStatement[] = [];
  let sql = "";
  let scan = "";
  let startLine = 0;
  let line = 1;
  let i = 0;

  const consume = (end: number, kind: "code" | "literal" | "comment") => {
    const chunk = source.slice(i, end);
    if (kind === "comment") {
      // A comment still separates tokens: `a/* x */b` is two words.
      sql += " ";
      scan += " ";
    } else {
      if (startLine === 0 && chunk.trim() !== "") startLine = line;
      sql += chunk;
      scan += kind === "literal" ? "''" : chunk;
    }
    for (const ch of chunk) if (ch === "\n") line++;
    i = end;
  };

  const flush = () => {
    const scanned = scan.replace(/\s+/g, " ").trim();
    if (scanned !== "") statements.push({ line: startLine, sql: sql.trim(), scan: scanned });
    sql = "";
    scan = "";
    startLine = 0;
  };

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    // `$tag$` opens a dollar quote unless the `$` continues an identifier (`a$b`) or is a parameter (`$1`).
    const dollarTag =
      ch === "$" && !IDENT_CHAR.test(source[i - 1] ?? "") ? DOLLAR_TAG.exec(source.slice(i, i + 64))?.[0] : undefined;
    if (ch === "-" && next === "-") {
      const newline = source.indexOf("\n", i);
      consume(newline === -1 ? source.length : newline, "comment");
    } else if (ch === "/" && next === "*") {
      consume(endOfBlockComment(source, i), "comment");
    } else if (ch === "'") {
      consume(endOfStringLiteral(source, i), "literal");
    } else if (ch === '"') {
      consume(endOfQuotedIdentifier(source, i), "code");
    } else if (dollarTag) {
      const close = source.indexOf(dollarTag, i + dollarTag.length);
      if (close === -1) throw new SqlParseError(`Unterminated dollar-quoted string ${dollarTag}`, lineAt(source, i));
      consume(close + dollarTag.length, "code");
    } else if (ch === ";") {
      flush();
      i++;
    } else {
      consume(i + 1, "code");
    }
  }
  flush();
  return statements;
}

const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*)`;
const QUALIFIED_NAME = String.raw`${IDENT}(?:\s*\.\s*${IDENT})?`;

/** Refused anywhere in a statement, including inside dollar-quoted bodies. */
const KEYWORD_RULES: ReadonlyArray<{ pattern: RegExp; rule: string }> = [
  { pattern: /\bDROP\b/i, rule: "DROP removes objects or data" },
  { pattern: /\bTRUNCATE\b/i, rule: "TRUNCATE deletes every row" },
  { pattern: /\bRENAME\b/i, rule: "RENAME breaks code (and the still-running deployment) that uses the old name" },
  { pattern: /\bDELETE\s+FROM\b/i, rule: "DELETE FROM removes rows" },
  {
    pattern: new RegExp(String.raw`\bUPDATE\s+(?:ONLY\s+)?${QUALIFIED_NAME}(?:\s*\*)?(?:\s+(?:AS\s+)?${IDENT})?\s+SET\b`, "i"),
    rule: "UPDATE … SET rewrites existing rows",
  },
  { pattern: /\bDO\s+UPDATE\b/i, rule: "ON CONFLICT DO UPDATE overwrites existing rows" },
  { pattern: /\bMERGE\s+INTO\b/i, rule: "MERGE can update or delete existing rows" },
  { pattern: /\bALTER\s+COLUMN\b/i, rule: "ALTER COLUMN changes an existing column" },
  { pattern: /\bSET\s+NOT\s+NULL\b/i, rule: "SET NOT NULL fails on (or rejects) legacy NULL rows" },
  { pattern: /\bSET\s+DATA\s+TYPE\b/i, rule: "SET DATA TYPE retypes an existing column" },
  { pattern: /\bADD\s+CONSTRAINT\b/i, rule: "ADD CONSTRAINT validates existing rows and can fail on legacy data" },
];

const TRANSACTION_CONTROL = /^(?:BEGIN|COMMIT|ROLLBACK|ABORT|END|START\s+TRANSACTION|SAVEPOINT|RELEASE|PREPARE\s+TRANSACTION)\b/i;
const CREATE_TABLE = new RegExp(
  String.raw`^CREATE\s+(?:(?:GLOBAL|LOCAL)\s+)?(?:(TEMP|TEMPORARY|UNLOGGED)\s+)?TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(${QUALIFIED_NAME})`,
  "i",
);
const CREATE_INDEX = /^CREATE\s+(UNIQUE\s+)?INDEX\b/i;
const CREATE_INDEX_GUARDED = new RegExp(
  String.raw`^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?IF\s+NOT\s+EXISTS\s+(${IDENT})\s+ON\s+(?:ONLY\s+)?(${QUALIFIED_NAME})`,
  "i",
);
const CREATE_IF_NOT_EXISTS_ONLY = /^CREATE\s+(?:(?:TEMP|TEMPORARY|UNLOGGED)\s+)?(EXTENSION|SCHEMA|SEQUENCE)\b(\s+IF\s+NOT\s+EXISTS\b)?/i;
const CREATE_TYPE = /^CREATE\s+(TYPE|DOMAIN)\b/i;
const INSERT = /^INSERT\s+INTO\b/i;
const COMMENT_ON = /^COMMENT\s+ON\b/i;
const SESSION_SETTING = /^(?:SET|RESET)\b/i;
const ALTER_STATEMENT = /^ALTER\b/i;
const ALTER_TABLE = new RegExp(String.raw`^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?${QUALIFIED_NAME}\s*\*?\s+(.+)$`, "i");
const ALTER_TYPE_ADD_VALUE = new RegExp(String.raw`^ALTER\s+TYPE\s+${QUALIFIED_NAME}\s+ADD\s+VALUE\s+IF\s+NOT\s+EXISTS\b`, "i");

/** `DO [LANGUAGE plpgsql] $tag$ body $tag$ [LANGUAGE plpgsql]`, on the executable text. */
const DO_BLOCK = /^DO\s+(?:LANGUAGE\s+plpgsql\s+)?(\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$)([\s\S]*?)\1(?:\s+LANGUAGE\s+plpgsql)?$/i;
const DO_BLOCK_RULE =
  "DO blocks may only wrap a single CREATE TYPE or CREATE DOMAIN, as " +
  "DO $$ BEGIN CREATE TYPE …; EXCEPTION WHEN duplicate_object THEN NULL; END $$ (anything else in one cannot be checked)";

/** Statements outside the allowlist that get a specific reason. */
const REFUSED_KINDS: ReadonlyArray<{ pattern: RegExp; rule: string }> = [
  { pattern: /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\b/i, rule: "CREATE TRIGGER can silently change or discard future writes" },
  { pattern: /^CREATE\s+(?:OR\s+REPLACE\s+)?RULE\b/i, rule: "CREATE RULE can silently rewrite or discard future writes" },
  { pattern: /^CREATE\s+POLICY\b/i, rule: "CREATE POLICY changes which rows the app can read or write" },
  { pattern: /^(?:GRANT|REVOKE)\b/i, rule: "GRANT and REVOKE change who can read or write data" },
  {
    pattern: /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\b/i,
    rule: "functions and procedures run code the guard cannot check",
  },
];

// A literal (string literals are already emptied in `scan`), optionally cast to a simple type,
// followed only by column-constraint keywords or the end of the action.
const SIMPLE_CAST = String.raw`(?:\s*::\s*[A-Za-z_]\w*(?:\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?(?:\[\])?)?`;
const DEFAULT_END = String.raw`(?=\s+(?:NOT\s+NULL|NULL|COLLATE)\b|\s*$)`;
const CONSTANT_DEFAULT = new RegExp(String.raw`\bDEFAULT\s+(?:''|[+-]?\d+(?:\.\d+)?|TRUE|FALSE)${SIMPLE_CAST}${DEFAULT_END}`, "i");
/** The transaction's start time: one value for every existing row, which Postgres stores once instead of rewriting the table. */
const START_TIME_DEFAULT = new RegExp(String.raw`\bDEFAULT\s+(?:now\s*\(\s*\)|CURRENT_TIMESTAMP|CURRENT_DATE|LOCALTIMESTAMP)${SIMPLE_CAST}${DEFAULT_END}`, "i");
/** Column kinds Postgres fills per row on ADD COLUMN, rewriting the table: serial types, identity and generated columns. */
const PER_ROW_COLUMN = /\b((?:SMALL|BIG)?SERIAL[248]?|GENERATED)\b/i;
/** An ADD COLUMN definition after the keywords: its name, then (captured) its type and options. */
const COLUMN_NAME = new RegExp(String.raw`^(?:IF\s+NOT\s+EXISTS\s+)?${IDENT}\s*(.*)$`, "i");

/** The case-folded parts of a possibly schema-qualified, possibly quoted name, as Postgres resolves them. */
function nameParts(qualified: string): string[] {
  return (qualified.match(new RegExp(IDENT, "g")) ?? [qualified]).map((part) =>
    part.startsWith('"') ? part.slice(1, -1).replace(/""/g, '"') : part.toLowerCase(),
  );
}

/** The bare, case-folded name (a table without its schema, or a column). */
function bareName(qualified: string): string {
  const parts = nameParts(qualified);
  return parts[parts.length - 1];
}

/**
 * `schema.table`, case-folded, so tables in different schemas are told apart.
 * An unqualified name is taken as `public`, the schema the app's default search_path uses.
 */
function tableKey(qualified: string): string {
  const parts = nameParts(qualified);
  return parts.length > 1 ? `${parts[parts.length - 2]}.${parts[parts.length - 1]}` : `public.${parts[0]}`;
}

/** The name as `to_regclass()` reads it: every part quoted, so its case survives. */
function regclassText(qualified: string): string {
  return nameParts(qualified)
    .map((part) => `"${part.replace(/"/g, '""')}"`)
    .join(".");
}

/** Split on commas outside parentheses and quoted identifiers. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (const ch of text) {
    if (quoted) {
      if (ch === '"') quoted = false;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
    } else if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current.trim());
  return parts;
}

function firstWords(text: string, count = 2): string {
  return text.split(" ").slice(0, count).join(" ");
}

function keywordViolations(scan: string): string[] {
  return KEYWORD_RULES.filter(({ pattern }) => pattern.test(scan)).map(({ rule }) => rule);
}

function addColumnViolations(action: string): string[] {
  const add = /^ADD\s+(?:COLUMN\s+)?/i.exec(action);
  if (!add) return [`ALTER TABLE may only ADD COLUMN (found "${firstWords(action)}")`];

  const definition = action.slice(add[0].length);
  if (/^(?:CONSTRAINT|UNIQUE|PRIMARY|FOREIGN|CHECK|EXCLUDE)\b/i.test(definition)) {
    return ["ALTER TABLE … ADD <table constraint> validates existing rows and can fail on legacy data"];
  }

  const problems: string[] = [];
  if (!/^IF\s+NOT\s+EXISTS\b/i.test(definition)) {
    problems.push("ADD COLUMN must use IF NOT EXISTS (a migration must be safe to run again)");
  }
  const constraint = /\b(UNIQUE|PRIMARY\s+KEY|REFERENCES|CHECK)\b/i.exec(definition);
  if (constraint) {
    problems.push(`ADD COLUMN … ${constraint[1].toUpperCase()} adds a constraint to an existing table`);
  }
  if (/\bNOT\s+NULL\b/i.test(definition) && !CONSTANT_DEFAULT.test(definition)) {
    problems.push("ADD COLUMN … NOT NULL needs a constant DEFAULT, or existing rows violate it");
  }
  // Type and options only, so a column merely named e.g. "serial" or "default" is not mistaken for one.
  const typeAndOptions = COLUMN_NAME.exec(definition)?.[1] ?? definition;
  const perRow = PER_ROW_COLUMN.exec(typeAndOptions);
  if (perRow) {
    problems.push(
      `ADD COLUMN … ${perRow[1].toUpperCase()} fills every existing row, which rewrites the whole table under an ` +
        "exclusive lock and stalls the live site",
    );
  } else if (
    /\bDEFAULT\b/i.test(typeAndOptions) &&
    !CONSTANT_DEFAULT.test(typeAndOptions) &&
    !START_TIME_DEFAULT.test(typeAndOptions)
  ) {
    problems.push(
      "ADD COLUMN … DEFAULT must be a constant (or now()): Postgres computes any other default per existing row, " +
        "which rewrites the whole table under an exclusive lock and stalls the live site",
    );
  }
  return problems;
}

const INSERT_TARGET = new RegExp(
  String.raw`^INSERT\s+INTO\s+(${QUALIFIED_NAME})(?:\s+AS\s+${IDENT})?(?:\s*\(([^()]*)\))?`,
  "i",
);
const NOT_EXISTS = /\bNOT\s+EXISTS\s*\(/gi;
const TABLE_REFERENCE = new RegExp(String.raw`\b(?:FROM|JOIN)\s+(?:ONLY\s+)?(${QUALIFIED_NAME})`, "gi");
const ON_CONFLICT_DO_NOTHING = /\bON\s+CONFLICT\b(.*?)\bDO\s+NOTHING\b/i;
const CONFLICT_COLUMNS = new RegExp(String.raw`^\(\s*(${IDENT}(?:\s*,\s*${IDENT})*)\s*\)(?:\s+WHERE\s.+)?$`, "i");
/** Values that differ on every run, so a conflict key built from them never clashes with an earlier run's row. */
const FRESH_VALUE = /\bDEFAULT\b|\b(?:gen_random_uuid|uuid_generate_v\w+|nextval|random)\s*\(/i;
const INSERT_RULE =
  "INSERT must use ON CONFLICT (<unique columns it supplies>) DO NOTHING or " +
  "WHERE NOT EXISTS (SELECT … FROM <the same table> …), or every re-run adds the rows again";

/** The text inside the parenthesis that opens at `open`. */
function parenthesised(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}

/**
 * An INSERT is re-runnable only if a second run inserts nothing. Every table
 * here has a generated `id` primary key, so ON CONFLICT DO NOTHING skips a row
 * only when it names unique columns the INSERT fills with fixed values, and
 * WHERE NOT EXISTS only when it looks in the table being inserted into.
 * Postgres itself rejects conflict columns that no unique index covers.
 */
function insertViolations(scan: string): string[] {
  const insert = INSERT_TARGET.exec(scan);
  if (!insert) return [INSERT_RULE];
  const target = tableKey(insert[1]);

  let readsOtherTables = false;
  for (const match of Array.from(scan.matchAll(NOT_EXISTS))) {
    const subquery = parenthesised(scan, (match.index ?? 0) + match[0].length - 1);
    const tables = Array.from(subquery.matchAll(TABLE_REFERENCE), (reference) => tableKey(reference[1]));
    if (tables.includes(target)) return [];
    readsOtherTables = true;
  }

  const conflict = ON_CONFLICT_DO_NOTHING.exec(scan);
  if (!conflict) {
    return readsOtherTables
      ? [`WHERE NOT EXISTS must look in "${bareName(insert[1])}", the table being inserted into, or every re-run adds the rows again`]
      : [INSERT_RULE];
  }
  const conflictTarget = conflict[1].trim();
  if (conflictTarget === "") {
    return [
      "ON CONFLICT DO NOTHING without conflict columns skips a row only if some unique key happens to clash, and a " +
        "generated id never does: name the unique columns the INSERT supplies, ON CONFLICT (<columns>) DO NOTHING",
    ];
  }
  const columns = CONFLICT_COLUMNS.exec(conflictTarget)?.[1];
  if (columns === undefined) {
    return ["ON CONFLICT must name plain columns, ON CONFLICT (<columns>) DO NOTHING, so the guard can check the INSERT supplies them"];
  }
  if (insert[2] === undefined) {
    return ["INSERT … ON CONFLICT must list its columns, INSERT INTO <table> (<columns>) …, so the guard can check it supplies the conflict columns"];
  }

  const supplied = new Set(splitTopLevel(insert[2]).map(bareName));
  const problems = splitTopLevel(columns)
    .map(bareName)
    .filter((column) => !supplied.has(column))
    .map(
      (column) =>
        `ON CONFLICT (${column}) names a column the INSERT does not supply; its default (e.g. gen_random_uuid()) ` +
        "never clashes, so every re-run adds the rows again",
    );
  if (FRESH_VALUE.test(scan)) {
    problems.push(
      "INSERT … ON CONFLICT must insert fixed values: DEFAULT, gen_random_uuid(), nextval() and random() give every " +
        "re-run new keys that never clash (leave such columns out to use their defaults)",
    );
  }
  return problems;
}

function alterViolations(scan: string): string[] {
  if (ALTER_TYPE_ADD_VALUE.test(scan)) return [];
  const alterTable = ALTER_TABLE.exec(scan);
  if (!alterTable) {
    return [`only "ALTER TABLE … ADD COLUMN IF NOT EXISTS" and "ALTER TYPE … ADD VALUE IF NOT EXISTS" are allowed (found "${firstWords(scan, 3)}")`];
  }
  return splitTopLevel(alterTable[1]).flatMap(addColumnViolations);
}

/**
 * The one DO block allowed: `BEGIN CREATE TYPE|DOMAIN …; EXCEPTION WHEN
 * duplicate_object THEN NULL; END`, which makes CREATE TYPE re-runnable. Its
 * body is parsed like a file, so the keyword rules see the inner statement with
 * its literals (e.g. enum labels) emptied.
 */
function doBlockViolations(sql: string): string[] {
  const body = DO_BLOCK.exec(sql)?.[2];
  if (body === undefined) return [DO_BLOCK_RULE];
  let inner: SqlStatement[];
  try {
    inner = splitSqlStatements(body);
  } catch {
    return [DO_BLOCK_RULE];
  }
  const [begin, handler, end, ...rest] = inner.map((statement) => statement.scan);
  const create = /^BEGIN\s+(CREATE\s+(?:TYPE|DOMAIN)\s.*)$/i.exec(begin ?? "")?.[1];
  const wellFormed =
    create !== undefined &&
    new RegExp(String.raw`^CREATE\s+(?:TYPE|DOMAIN)\s+${QUALIFIED_NAME}\s+AS\b`, "i").test(create) &&
    /^EXCEPTION\s+WHEN\s+duplicate_object\s+THEN\s+NULL$/i.test(handler ?? "") &&
    /^END$/i.test(end ?? "") &&
    rest.length === 0;
  return wellFormed ? keywordViolations(create) : [DO_BLOCK_RULE];
}

/**
 * Every rule one statement breaks, as human-readable reasons (empty when it is
 * safe). `createdInFile` holds the tables (`schema.table`, see tableKey)
 * created by earlier statements in the same file: the only ones a UNIQUE index
 * may be added to. The runner then checks the live database too
 * (createIndexStatements), because CREATE TABLE IF NOT EXISTS on an existing
 * table creates nothing.
 */
export function findStatementViolations(statement: SqlStatement, createdInFile: ReadonlySet<string> = new Set()): string[] {
  const { scan } = statement;
  if (/^DO\b/i.test(scan)) {
    // A refused DO block still lists the destructive keywords in its body, to explain why.
    const problems = doBlockViolations(statement.sql);
    return problems.includes(DO_BLOCK_RULE) ? Array.from(new Set([DO_BLOCK_RULE, ...keywordViolations(scan)])) : problems;
  }

  const problems = keywordViolations(scan);
  const createTable = CREATE_TABLE.exec(scan);
  const createOnly = CREATE_IF_NOT_EXISTS_ONLY.exec(scan);

  if (TRANSACTION_CONTROL.test(scan)) {
    problems.push("transaction control belongs to the runner (use `-- runner:no-transaction` instead)");
  } else if (createTable) {
    if (!createTable[2]) problems.push("CREATE TABLE must use IF NOT EXISTS (a migration must be safe to run again)");
  } else if (CREATE_INDEX.test(scan)) {
    const target = CREATE_INDEX_GUARDED.exec(scan)?.[2];
    if (target === undefined) {
      problems.push("CREATE INDEX must name the index and use IF NOT EXISTS (a migration must be safe to run again)");
    } else if (CREATE_INDEX.exec(scan)?.[1] && !createdInFile.has(tableKey(target))) {
      problems.push(
        `CREATE UNIQUE INDEX on "${bareName(target)}", which this file did not create, fails if existing rows have duplicates`,
      );
    }
  } else if (ALTER_STATEMENT.test(scan)) {
    problems.push(...alterViolations(scan));
  } else if (createOnly) {
    if (!createOnly[2]) problems.push(`CREATE ${createOnly[1].toUpperCase()} must use IF NOT EXISTS (a migration must be safe to run again)`);
  } else if (CREATE_TYPE.test(scan)) {
    problems.push(
      "CREATE TYPE and CREATE DOMAIN have no IF NOT EXISTS: wrap them as " +
        "DO $$ BEGIN CREATE TYPE …; EXCEPTION WHEN duplicate_object THEN NULL; END $$",
    );
  } else if (INSERT.test(scan)) {
    problems.push(...insertViolations(scan));
  } else if (SESSION_SETTING.test(scan)) {
    problems.push(
      "SET and RESET belong to the runner, whose lock_timeout (5s) and statement_timeout (60s) stop a migration " +
        "from stalling the live site behind a lock",
    );
  } else if (!COMMENT_ON.test(scan)) {
    const refused = REFUSED_KINDS.find(({ pattern }) => pattern.test(scan));
    if (refused) {
      problems.push(refused.rule);
    } else if (problems.length === 0) {
      problems.push(`"${firstWords(scan, 4)}" is not one of the additive, re-runnable statements migrations may contain`);
    }
  }

  return Array.from(new Set(problems));
}

/** The table a statement creates (`schema.table`), if it is a CREATE TABLE of a lasting table. */
function createdTable(scan: string): string | undefined {
  const match = CREATE_TABLE.exec(scan);
  // A temporary table lives in its own schema and vanishes with the session: it creates nothing to index.
  if (!match || /^TEMP/i.test(match[1] ?? "")) return undefined;
  return tableKey(match[3]);
}

/** Run the guard over one file's parsed statements, in order; an empty result means the file is safe to apply. */
export function findGuardViolations(statements: readonly SqlStatement[]): GuardViolation[] {
  const createdInFile = new Set<string>();
  return statements.flatMap((statement) => {
    const violations = findStatementViolations(statement, createdInFile).map((rule) => ({
      line: statement.line,
      rule,
      excerpt: statement.scan.length > 100 ? `${statement.scan.slice(0, 97)}...` : statement.scan,
    }));
    const table = createdTable(statement.scan);
    if (table !== undefined) createdInFile.add(table);
    return violations;
  });
}

export interface CreateIndexStatement {
  line: number;
  /** The index name, case-folded as Postgres stores it in pg_class.relname. */
  index: string;
  /** The indexed table, as `to_regclass()` reads it. */
  table: string;
  unique: boolean;
}

/**
 * Every `CREATE [UNIQUE] INDEX … IF NOT EXISTS` in a file, for the runner's
 * checks against the live database: a UNIQUE one may only be built on a table
 * the run itself creates, and none may be skipped because an INVALID index
 * already holds its name.
 */
export function createIndexStatements(statements: readonly SqlStatement[]): CreateIndexStatement[] {
  return statements.flatMap(({ line, scan }) => {
    const guarded = CREATE_INDEX_GUARDED.exec(scan);
    if (!guarded) return [];
    return [{ line, index: bareName(guarded[1]), table: regclassText(guarded[2]), unique: Boolean(CREATE_INDEX.exec(scan)?.[1]) }];
  });
}
