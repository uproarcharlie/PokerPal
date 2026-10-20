/** The club forms' schemas (taken from shared/api/clubs, never restated) and their values from a ClubDto. */
import { z } from "zod";
import { clubSlugSchema, createClubSchema, updateClubSchema } from "@shared/api/clubs";
import type { ClubDto } from "@shared/api/public";
import { DEFAULT_TIME_ZONE } from "@/lib/format";

const PROFILE_FIELDS = { name: true, slug: true, description: true, imageUrl: true, address: true, timezone: true } as const;
const SOCIAL_FIELDS = { discordUrl: true, twitterUrl: true, facebookUrl: true, instagramUrl: true, websiteUrl: true } as const;

/** What the create form and the settings' Profile tab edit. */
export interface ClubProfileValues {
  name: string;
  slug: string;
  /** Rich text; "" for none. */
  description: string;
  imageUrl: string | null;
  address: string;
  timezone: string;
}

export type ClubSocialField = keyof typeof SOCIAL_FIELDS;
export type ClubSocialValues = Record<ClubSocialField, string>;

/** POST /api/clubs, profile fields only. */
export const createClubFormSchema = createClubSchema.pick(PROFILE_FIELDS);

/**
 * PUT /api/clubs/:id from the Profile tab. A changed slug must pass today's rules (clubSlugSchema); an
 * unchanged one is sent as it is, however old, exactly as the server decides (contract §2.4).
 */
export function clubProfileFormSchema(storedSlug: string) {
  return updateClubSchema
    .pick(PROFILE_FIELDS)
    .extend({ name: createClubSchema.shape.name, slug: z.string().trim() })
    .superRefine((values, ctx) => {
      if (values.slug === storedSlug) return;
      const checked = clubSlugSchema.safeParse(values.slug);
      if (!checked.success) {
        for (const issue of checked.error.issues) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["slug"], message: issue.message });
      }
    });
}

/** PUT /api/clubs/:id from the Social links tab: http(s) links only, blank for none. */
export const clubSocialFormSchema = updateClubSchema.pick(SOCIAL_FIELDS);

export function profileValues(club?: ClubDto): ClubProfileValues {
  return {
    name: club?.name ?? "",
    slug: club?.slug ?? "",
    description: club?.description ?? "",
    imageUrl: club?.imageUrl ?? null,
    address: club?.address ?? "",
    // A club without one has always been shown in DEFAULT_TIME_ZONE; the select says so.
    timezone: club?.timezone?.trim() || DEFAULT_TIME_ZONE,
  };
}

export function socialValues(club: ClubDto): ClubSocialValues {
  return {
    discordUrl: club.discordUrl ?? "",
    twitterUrl: club.twitterUrl ?? "",
    facebookUrl: club.facebookUrl ?? "",
    instagramUrl: club.instagramUrl ?? "",
    websiteUrl: club.websiteUrl ?? "",
  };
}

/** A club URL made from its name: "Central Stars!" → "central-stars". */
export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
