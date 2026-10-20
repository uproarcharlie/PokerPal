import { Globe, type LucideIcon } from "lucide-react";
import type { IconType } from "react-icons";
import { FaDiscord, FaFacebook, FaInstagram } from "react-icons/fa";
import { FaXTwitter } from "react-icons/fa6";
import type { ClubDto } from "@shared/api/public";
import { safeHttpUrl } from "@shared/domain/urls";

type SocialClub = Pick<ClubDto, "discordUrl" | "twitterUrl" | "facebookUrl" | "instagramUrl" | "websiteUrl">;

interface SocialLink {
  href: string | null;
  title: string;
  Icon: IconType | LucideIcon;
}

/** The club's links that are real http(s) addresses, whatever an older row stored (P2REV0-SEC-05). */
function linksOf(club: SocialClub): Array<SocialLink & { href: string }> {
  const links: SocialLink[] = [
    { href: safeHttpUrl(club.discordUrl), title: "Discord", Icon: FaDiscord },
    { href: safeHttpUrl(club.twitterUrl), title: "Twitter/X", Icon: FaXTwitter },
    { href: safeHttpUrl(club.facebookUrl), title: "Facebook", Icon: FaFacebook },
    { href: safeHttpUrl(club.instagramUrl), title: "Instagram", Icon: FaInstagram },
    { href: safeHttpUrl(club.websiteUrl), title: "Website", Icon: Globe },
  ];
  return links.filter((link): link is SocialLink & { href: string } => link.href !== null);
}

/** The club's social and web links as icons; nothing when it has none. */
export function SocialLinks({ club }: { club: SocialClub }) {
  const links = linksOf(club);
  if (links.length === 0) return null;
  return (
    <ul role="list" className="mt-3 flex flex-wrap items-center gap-1" aria-label="The club online">
      {links.map(({ href, title, Icon }) => (
        <li key={title}>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={title}
            aria-label={title}
            className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
          </a>
        </li>
      ))}
    </ul>
  );
}
