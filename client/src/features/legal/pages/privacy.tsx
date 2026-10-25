import type { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { routes } from "@/app/routes";
import { usePageMeta } from "@/app/page-meta";
import { PRIVACY_CONTACT_EMAIL, PRIVACY_UPDATED } from "../privacy-contact";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      <div className="space-y-3 text-muted-foreground">{children}</div>
    </section>
  );
}

function List({ items }: { items: ReactNode[] }) {
  return (
    <ul role="list" className="list-disc space-y-1 pl-5">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

const linkClass = "font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The privacy notice (CC-06): what LovePoker.club collects about players and club staff, why, who
 * sees it, how long it is kept, and how to ask for it to be shown, corrected or deleted under the
 * New Zealand Privacy Act 2020. The QR sign-up links here where players give their details.
 */
export default function Privacy() {
  usePageMeta({ title: "Privacy" });
  return (
    <article className="mx-auto max-w-2xl space-y-8 px-4 py-10 text-foreground sm:px-6">
      <Link href={routes.home()} className={`inline-flex items-center gap-1 text-sm ${linkClass}`}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        LovePoker.club
      </Link>

      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground">Privacy</h1>
        <p className="text-sm text-muted-foreground">Last updated {PRIVACY_UPDATED}</p>
        <p className="text-muted-foreground">
          LovePoker.club is a website poker clubs use to run their tournaments and season leaderboards. This notice explains what
          we keep about you, why, who can see it and what you can ask us to do with it, as the New Zealand Privacy Act 2020 requires.
        </p>
      </header>

      <Section title="What we collect">
        <p>If you sign up to play in a tournament (for example by scanning a club&apos;s QR code), we keep:</p>
        <List
          items={[
            "your name;",
            "your phone number, so a club can recognise you when you come back and contact you about a game;",
            "a photo of you, only if you choose to take or upload one;",
            "your tournament entries and results: buy-ins, re-buys and add-ons, finishing places, knockouts, points and prizes.",
          ]}
        />
        <p>If you have a staff account to run a club, we also keep your name, email address, an optional phone number and your password (stored only in a scrambled form that cannot be read back).</p>
        <p>
          To keep the site secure, our servers use the network address a request comes from to limit misuse, and staff who sign in
          get a cookie that keeps them signed in. We do not use advertising or tracking cookies.
        </p>
        <p>
          We count visits with Cloudflare Web Analytics, which sets no cookies and does not identify you: it records which pages
          are opened, the site a visit came from, and the kind of browser and device and the country it came from.
        </p>
      </Section>

      <Section title="Why we collect it">
        <List
          items={[
            "to let clubs run their tournaments: who is playing, who has paid, who went out and who won;",
            "to show tournament standings and season leaderboards;",
            "to recognise a returning player by their phone number, so the same person is not signed up twice;",
            "to protect the site from misuse, such as too many sign-ups from one network.",
          ]}
        />
      </Section>

      <Section title="Who can see it">
        <List
          items={[
            "Your name, photo and results appear on the club's public tournament pages and leaderboards, which anyone with the link can open. Tournament pages that name players ask search engines not to list them.",
            "Your phone number is seen only by the staff of the club you first played at and by the site's administrators. It never appears on a public page.",
            "Staff email addresses are seen only by the site's administrators and the club's owner.",
          ]}
        />
        <p>We do not sell your details or give them to anyone for marketing.</p>
      </Section>

      <Section title="Where it is kept, and for how long">
        <p>
          Your details are stored by the companies that host the site and its pictures for us, which may keep them on servers outside
          New Zealand. We keep them for as long as the club runs its tournaments and leaderboards on LovePoker.club, because results
          are part of the club&apos;s records. If you ask us to delete your details, we remove your name, phone number and photo, and
          any results we keep for the club&apos;s records no longer identify you.
        </p>
      </Section>

      <Section title="Your rights">
        <p>Under the Privacy Act 2020 you can ask:</p>
        <List
          items={["to see the details we hold about you;", "for any of them to be corrected;", "for your details to be deleted."]}
        />
        <p>
          Ask the club&apos;s staff at your next game, or email us at{" "}
          <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className={linkClass}>
            {PRIVACY_CONTACT_EMAIL}
          </a>
          . We may ask you to confirm who you are first, and we will reply within 20 working days.
        </p>
        <p>
          If you are not happy with how we handle your request, you can complain to the{" "}
          <a href="https://www.privacy.org.nz" target="_blank" rel="noopener noreferrer" className={linkClass}>
            Office of the Privacy Commissioner
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          .
        </p>
      </Section>
    </article>
  );
}
