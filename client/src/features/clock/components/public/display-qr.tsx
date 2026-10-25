import { QRCodeSVG } from "qrcode.react";
import type { LiveDisplayDto } from "@shared/api/live-display";
import { absoluteUrl } from "@/app/routes";
import { cn } from "@/lib/utils";
import { LINE, px, textEm } from "./screen-plan";

type DisplayQrTarget = NonNullable<LiveDisplayDto["qr"]>;

/** What scanning leads to, as the TV says it under the code. */
export function qrCaption(qr: DisplayQrTarget, season: LiveDisplayDto["season"]): string {
  if (qr.target === "season" && season) return `Scan for the ${season.name} leaderboard`;
  if (qr.target === "seats") return "Find your seat";
  return "Scan for live results";
}

/** The link without its scheme, for anyone who would rather type it: "lovepoker.club/season/s1". */
const typedLink = (url: string) => url.replace(/^https?:\/\//, "");

interface DisplayQrProps {
  qr: DisplayQrTarget;
  season: LiveDisplayDto["season"];
  /** The code's side and the caption's size in pixels (the screen plan's). */
  size: number;
  caption: number;
  className?: string;
}

/**
 * The QR code the room scans: to the season leaderboard (or the tournament page, or the seat finder),
 * large enough to scan from a few metres (round 5, item 23), with a short caption. The link to type
 * is written under it where it fits on one line, else only for screen readers.
 */
export function DisplayQr({ qr, season, size, caption, className }: DisplayQrProps) {
  const url = absoluteUrl(qr.path);
  const words = qrCaption(qr, season);
  const link = typedLink(url);
  const linkSize = Math.max(12, caption * 0.7);
  const linkFits = textEm(link) * linkSize <= size * 1.1;
  return (
    <figure className={cn("flex min-w-0 flex-col items-center text-center", className)} style={{ gap: px(caption * 0.3) }} data-testid="display-qr">
      {/* Dark on light whatever the theme: scanners need the contrast. */}
      <div className="rounded-xl bg-white p-[4%]" style={{ width: px(size), height: px(size) }}>
        <QRCodeSVG value={url} size={240} level="M" marginSize={2} title={words} style={{ width: "100%", height: "100%" }} />
      </div>
      <figcaption className="max-w-full">
        <span className="line-clamp-2 font-bold text-foreground" style={{ fontSize: px(caption), lineHeight: LINE.label }}>
          {words}
        </span>
        <span className={linkFits ? "block truncate font-semibold text-muted-foreground" : "sr-only"} style={linkFits ? { fontSize: px(linkSize), lineHeight: 1.2 } : undefined}>
          {link}
        </span>
      </figcaption>
    </figure>
  );
}
