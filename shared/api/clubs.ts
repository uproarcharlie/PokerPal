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
