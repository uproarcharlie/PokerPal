/** /api/clubs/*: club profile, club staff (owner + managers). Public reads use ClubDto (shared/api/public). */
import { z } from "zod";
import { SEATING_LIMITS } from "../domain/seating";
import { TABLE_SHAPES } from "../domain/table-layout";
import { readTheme, themeProblems, type ClubTheme } from "../domain/theme";
import { httpUrlSchema, idSchema, imageUrlSchema, nullableIntegerSchema, optionalText, requiredText } from "./common";
import { accountEmailSchema } from "./auth";

/**
 * Paths a slug would shadow or confuse. Lookups are case-insensitive, so slugs are stored lowercase
 * (CC-17). Existing slugs are never rewritten; this only applies to new and changed slugs.
 */
export const RESERVED_SLUGS = [
  "admin",
  "api",
  "app",
  "club",
  "clubs",
  "clock",
  "dashboard",
  "login",
  "logout",
  "new",
  "public",
  "register",
  "season",
  "settings",
  "signup",
  "static",
  "tournament",
  "uploads",
] as const;

const RESERVED: ReadonlySet<string> = new Set(RESERVED_SLUGS);

export const clubSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "Use at least 2 characters")
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase letters, numbers, and hyphens only")
  .refine((slug) => !RESERVED.has(slug), "That URL is reserved; choose another");

/** At most 16 characters, e.g. "AP"; blank means the default label ("Rake"). */
export const rakeLabelSchema = optionalText(16);

/** IANA zone such as "Pacific/Auckland"; checked against Intl on the server. */
export const timezoneSchema = optionalText(64);

/**
 * clubs.theme (round 5): checked by shared/domain/theme themeProblems (version 1, a known preset or
 * null, colours as #RRGGBB, nothing else) and stored with its colours in upper case. Null goes back
 * to the LovePoker look.
 */
export const clubThemeSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    for (const problem of themeProblems(value)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: problem.path, message: problem.message });
  })
  .transform((value) => readTheme(value) as ClubTheme);

/**
 * Club fields staff may write. `description` is rich text: the server sanitises it to an allowlist of
 * tags and http(s)/mailto links before storing (SEC-08), so what it returns may differ from the input.
 * Never accepted: ownerId (PUT /api/clubs/:id/owner), id, createdAt.
 */
const clubFields = {
  name: requiredText(100),
  slug: clubSlugSchema,
  description: optionalText(20_000),
  imageUrl: imageUrlSchema,
  timezone: timezoneSchema,
  address: optionalText(300),
  discordUrl: httpUrlSchema,
  twitterUrl: httpUrlSchema,
  facebookUrl: httpUrlSchema,
  instagramUrl: httpUrlSchema,
  websiteUrl: httpUrlSchema,
  rakeLabel: rakeLabelSchema,
  /** Round 5: the club's tournaments' tables (null: 9 seats, oval), its QR sign-up's photo rule, and its colours. */
  defaultSeatsPerTable: nullableIntegerSchema(SEATING_LIMITS.minSeats, SEATING_LIMITS.maxSeats),
  defaultTableShape: z.enum(TABLE_SHAPES).nullable().optional(),
  requireSignupPhoto: z.boolean().optional(),
  theme: clubThemeSchema.nullable().optional(),
};

/**
 * The most a club's description may be once sanitised (what is stored and sent): escaping can make
 * text several times longer than what was typed ("<" is stored as "&lt;"), and every public list
 * carries it.
 */
export const CLUB_DESCRIPTION_STORED_MAX = 40_000;

/**
 * How many clubs one account may own, unless it is an admin's (409 CLUB_LIMIT_REACHED): every club is
 * listed on the public home page, so opening clubs in bulk must not be free (P2REV0-SEC-02).
 */
export const MAX_CLUBS_PER_OWNER = 10;

/**
 * POST /api/clubs: the signed-in user becomes the owner. At most MAX_CLUBS_PER_OWNER per account
 * (admins excepted), and a few per hour per account and per visitor (429).
 */
export const createClubSchema = z.object(clubFields);
export type CreateClubInput = z.infer<typeof createClubSchema>;

/**
 * PUT /api/clubs/:id: any subset; absent fields are kept. The edit forms send every field, including
 * an unchanged slug that may predate today's rules, so the slug is only checked against
 * `clubSlugSchema` when it differs from the stored one (the service does that, 400 VALIDATION).
 */
export const updateClubSchema = z
  .object({ ...clubFields, slug: z.string().trim().min(1).max(60) })
  .partial();
export type UpdateClubInput = z.infer<typeof updateClubSchema>;

/** GET /api/clubs?limit= : oldest first; `limit` keeps a public page's list short (the home page). */
export const clubsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type ClubsQuery = z.infer<typeof clubsQuerySchema>;

/** DELETE /api/clubs/:id/managers/:userId */
export const clubManagerParamsSchema = z.object({ id: idSchema, userId: idSchema });

/**
 * PUT /api/clubs/:id/owner (admins only): an account the admin picked by id (from user management),
 * or `{ userId: null }` to leave the club without an owner. A new owner's manager row, if any, is
 * removed in the same transaction (owning implies managing). Handing a club to someone by their email
 * address is an owner invitation instead (POST /api/clubs/:id/invites): nothing proves an account owns
 * the address it signed up with (SEC-P2REV-03).
 */
export const setClubOwnerSchema = z.object({ userId: idSchema.nullable() }).strict();
export type SetClubOwnerInput = z.infer<typeof setClubOwnerSchema>;

/**
 * Staff invitations (SEC-P2REV-03). Nothing proves an account owns the email address it signed up
 * with (or changed to), so naming an address never grants a role by itself: the owner (or an admin)
 * creates an invitation, sends its link to the person, and the role is granted only when the person
 * opens it signed in to the account that uses the invited address. The link's secret is shown once,
 * works once, and lapses after STAFF_INVITE_TTL_DAYS or when revoked.
 */
export const STAFF_INVITE_ROLES = ["manager", "owner"] as const;
export type StaffInviteRole = (typeof STAFF_INVITE_ROLES)[number];

export const STAFF_INVITE_TTL_DAYS = 7;

/** Where the client opens an invitation; the secret travels in the fragment (`#<token>`), never to a server log. */
export const STAFF_INVITE_PATH = "/staff-invite";

/**
 * POST /api/clubs/:id/invites (the owner or an admin; an owner invitation, admins only). The email
 * is matched ignoring case. An open invitation for the same address and role is replaced.
 */
export const createStaffInviteSchema = z.object({
  email: accountEmailSchema,
  role: z.enum(STAFF_INVITE_ROLES).default("manager"),
});
export type CreateStaffInviteInput = z.infer<typeof createStaffInviteSchema>;

/** DELETE /api/clubs/:id/invites/:inviteId */
export const staffInviteParamsSchema = z.object({ id: idSchema, inviteId: idSchema });

/** POST /api/staff-invites/accept (signed in): the secret from the link. */
export const acceptStaffInviteSchema = z.object({ token: z.string().trim().regex(/^[A-Za-z0-9_-]{20,128}$/, "Invalid invitation") });
export type AcceptStaffInviteInput = z.infer<typeof acceptStaffInviteSchema>;

/** An open invitation, as the club's owner and admins see it (never its secret). */
export interface StaffInviteDto {
  id: string;
  email: string;
  role: StaffInviteRole;
  createdAt: string;
  expiresAt: string;
}

/** POST /api/clubs/:id/invites (201): the staff with the new invitation, and its secret, shown this once. */
export interface CreateStaffInviteResponse {
  staff: ClubStaffDto;
  invite: StaffInviteDto;
  /** Goes in the link: `${origin}${STAFF_INVITE_PATH}#${token}`. Only its hash is stored. */
  token: string;
}

/** POST /api/staff-invites/accept (200). */
export interface AcceptStaffInviteResponse {
  clubId: string;
  clubName: string;
  role: StaffInviteRole;
}

/** A staff member as owners and admins see them. */
export interface StaffUser {
  id: string;
  name: string;
  email: string;
}

export const CLUB_MANAGER_ROLES = ["manager"] as const;
export type ClubManagerRole = (typeof CLUB_MANAGER_ROLES)[number];

export interface ClubManagerDto {
  user: StaffUser;
  role: ClubManagerRole;
  createdAt: string;
}

/** GET /api/clubs/:id/managers, and the body of every staff change. */
export interface ClubStaffDto {
  clubId: string;
  owner: StaffUser | null;
  managers: ClubManagerDto[];
  /** Invitations not yet accepted, revoked or expired, oldest first. */
  invites: StaffInviteDto[];
}

/**
 * GET /api/clubs/:id/members-count: the players known at the club (registered for one of its
 * tournaments, or it is their home club), each once: the same players its staff Players list shows.
 */
export interface MembersCountResponse {
  count: number;
}

/** GET /api/clubs/member-counts: the same count for every club, by club id. */
export type MemberCountsResponse = Record<string, number>;

/* ---------- bank transfer payments (round 8: Club settings → Payments) ---------- */

/** "12-3456-7890123-00": bank, branch, account, and a suffix of 2 or 3 digits. */
const NZ_BANK_ACCOUNT = /^(\d{2})-(\d{4})-(\d{7})-(\d{2,3})$/;

/**
 * A New Zealand bank account number as the banks write it ("12-3456-7890123-00", or a 3-digit suffix
 * "-000"), from what someone typed: dashes, spaces or nothing between the parts ("12 3456 7890123 00",
 * "123456789012300"). Null when it is not one. The digits are not checked against the banks' check-digit
 * rules: a refusal of a real account would stop a club taking payments, and the club checks its own number.
 */
export function normaliseNzBankAccount(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length > 40) return null;
  const parts = trimmed.split(/[\s-]+/).filter((part) => part !== "");
  const digits = parts.join("");
  if (!/^\d{15,16}$/.test(digits)) return null;
  const formatted =
    parts.length === 1 ? `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 13)}-${digits.slice(13)}` : parts.join("-");
  return NZ_BANK_ACCOUNT.test(formatted) ? formatted : null;
}

export const BANK_DETAILS_LIMITS = Object.freeze({ accountName: 100, bankName: 60, instructions: 300 });

/** A New Zealand account number, stored as the banks write it (normaliseNzBankAccount). */
export const nzBankAccountSchema = z.string().transform((text, ctx) => {
  const formatted = normaliseNzBankAccount(text);
  if (formatted !== null) return formatted;
  ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a New Zealand account number, like 12-3456-7890123-00" });
  return z.NEVER;
});

/** The club's bank details as its staff type them: the account's name and number, and optionally the bank and a short note. */
export const bankDetailsSchema = z.object({
  accountName: requiredText(BANK_DETAILS_LIMITS.accountName),
  accountNumber: nzBankAccountSchema,
  bankName: optionalText(BANK_DETAILS_LIMITS.bankName),
  instructions: optionalText(BANK_DETAILS_LIMITS.instructions),
});

/**
 * PUT /api/clubs/:id/payments (the club's owner and managers, and admins): the club's bank details,
 * replaced whole (a bank or note left out is removed), or `bankDetails: null` to remove them. Removing
 * them stops every tournament of the club showing them after sign-up, whatever its
 * showBankTransfer says (that setting is kept, for when details are added again).
 */
export const updateClubPaymentsSchema = z.object({ bankDetails: bankDetailsSchema.nullable() });
export type UpdateClubPaymentsInput = z.infer<typeof updateClubPaymentsSchema>;

/** A club's bank account for payments by transfer (round 8). */
export interface BankDetails {
  accountName: string;
  /** As the banks write it: "12-3456-7890123-00". */
  accountNumber: string;
  bankName: string | null;
  /** The club's own note for players paying by transfer, e.g. "Pay by 5pm on the day". */
  instructions: string | null;
}

/** The parts of the bank details, in the order the Payments tab shows them. */
export const BANK_DETAILS_FIELDS = Object.freeze(["accountName", "accountNumber", "bankName", "instructions"] as const satisfies readonly (keyof BankDetails)[]);

/** How many of the latest changes to the bank details the Payments tab is sent. */
export const BANK_DETAILS_CHANGES_SHOWN = 5;

/**
 * One change to the club's bank details, from the audit log: any of its staff may change them, and a
 * new account number redirects every transfer that follows, so the tab says who did it, and when
 * (R8REV0-PRIV-03). No values: what the details are now is beside it.
 */
export interface BankDetailsChangeDto {
  /** ISO 8601. */
  at: string;
  /** Who made it (a staff member, or an admin): their name; null once their account is gone. */
  by: string | null;
  /** "added" when the club had none before, "removed" when it has none after. */
  change: "added" | "changed" | "removed";
  /** The parts that differ: every part set before or after, for an added or removed one. */
  fields: (keyof BankDetails)[];
}

/**
 * GET and PUT /api/clubs/:id/payments (the club's owner and managers, and admins). Never on a public
 * page, the TV or a public response: the one other place the details go is the answer to a sign-up
 * with a buy-in to transfer (shared/api/registrations PaymentInstructionsDto).
 */
export interface ClubPaymentsDto {
  clubId: string;
  /** Null: none set, so no tournament of the club can show them (showBankTransfer is refused). */
  bankDetails: BankDetails | null;
  /** The latest changes, newest first (at most BANK_DETAILS_CHANGES_SHOWN): "Last changed by Sam on 17 Nov". */
  changes: BankDetailsChangeDto[];
}
