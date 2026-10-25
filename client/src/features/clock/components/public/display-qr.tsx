import { QRCodeSVG } from "qrcode.react";
import type { LiveDisplayDto } from "@shared/api/live-display";
import { absoluteUrl } from "@/app/routes";
import { cn } from "@/lib/utils";

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
  className?: string;
}

/** The QR code the room scans: to the season leaderboard (or the tournament page, or the seat finder). */
export function DisplayQr({ qr, season, className }: DisplayQrProps) {
  const url = absoluteUrl(qr.path);
  const caption = qrCaption(qr, season);
  return (
    <figure className={cn("flex flex-col items-center gap-2 text-center", className)} data-testid="display-qr">
      {/* Dark on light whatever the theme: scanners need the contrast. */}
      <div className="w-[clamp(8rem,min(16vw,24vh),15rem)] rounded-xl bg-white p-3">
        <QRCodeSVG value={url} size={240} level="M" marginSize={2} title={caption} style={{ width: "100%", height: "auto" }} />
      </div>
      <figcaption>
        <span className="block text-[clamp(1rem,min(1.7vw,2.4vh),1.6rem)] font-semibold leading-tight text-foreground">{caption}</span>
        <span className="block break-all text-[clamp(0.75rem,min(1.1vw,1.6vh),1.1rem)] text-muted-foreground">{typedLink(url)}</span>
      </figcaption>
    </figure>
  );
}
