import type { HelmetOptions } from "helmet";
import type { AppEnv } from "../config/env";

/**
 * The origin of R2_PUBLIC_URL (e.g. a custom domain such as https://images.example.com), where
 * uploaded images are served from in production. Undefined when unset or not an http(s) URL.
 */
export function imageStorageOrigin(publicUrl: string | undefined): string | undefined {
  if (!publicUrl) return undefined;
  try {
    const url = new URL(publicUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/** Where Cloudflare Web Analytics' beacon is loaded from, and where it sends what it counts. */
const CLOUDFLARE_ANALYTICS = {
  script: "https://static.cloudflareinsights.com",
  reports: "https://cloudflareinsights.com",
} as const;

/**
 * Helmet's settings: a Content-Security-Policy in production only (Vite's dev server needs inline
 * scripts), and no COEP, so cross-origin images (R2, Google Maps) load.
 *
 * - Scripts come only from our own origin: the production index.html loads one hashed module and has
 *   no inline script, so stored HTML (club descriptions) can never run script (SEC-08). The Google Maps
 *   script stays blocked as it is today, until the address field is rebuilt (CC-03).
 * - The one other script is the Cloudflare Web Analytics beacon, which Cloudflare's proxy adds to every
 *   page (an external file, no inline script); it reports to cloudflareinsights.com (connect-src).
 *   Refused, it logged a CSP error on every page and the analytics never counted a visit.
 * - Images may also come from the image store's public origin (R2_PUBLIC_URL), which a custom domain
 *   would otherwise be blocked by (SEC-17), besides r2.dev and Google Maps tiles. The R2 S3 API host
 *   (*.r2.cloudflarestorage.com) is not allowed: it only answers signed requests, so no image is ever
 *   served from it, and loadEnv refuses it as R2_PUBLIC_URL (img-02).
 * - Fonts and styles stay as they are; Phase 5 self-hosts the fonts.
 * Helmet adds its defaults to these: base-uri, form-action and frame-ancestors 'self',
 * script-src-attr 'none' and upgrade-insecure-requests.
 */
export function securityHeaders(env: AppEnv): HelmetOptions {
  const imageStore = imageStorageOrigin(env.R2_PUBLIC_URL);
  return {
    contentSecurityPolicy:
      env.NODE_ENV === "production"
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", CLOUDFLARE_ANALYTICS.script],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: [
                "'self'",
                "data:",
                "blob:",
                ...(imageStore ? [imageStore] : []),
                "https://*.r2.dev",
                "https://maps.googleapis.com",
                "https://maps.gstatic.com",
              ],
              connectSrc: ["'self'", CLOUDFLARE_ANALYTICS.reports],
              fontSrc: ["'self'", "data:"],
              objectSrc: ["'none'"],
              mediaSrc: ["'self'"],
              frameSrc: ["'self'"],
            },
          }
        : false,
    crossOriginEmbedderPolicy: false,
  };
}
