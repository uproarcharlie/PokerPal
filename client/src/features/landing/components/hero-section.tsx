import { Link } from "wouter";
import { ArrowRight, Sparkles } from "lucide-react";
import { SITE_NAME } from "@/app/page-meta";
import { routes } from "@/app/routes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { HERO_STATS, TONE_CLASSES } from "../content";

/** The opening pitch, its two calls to action and the three headline numbers. */
export function HeroSection() {
  return (
    <section className="container mx-auto px-4 py-16 sm:py-20 lg:py-32">
      <div className="mx-auto max-w-5xl text-center">
        <Badge className="mb-4 whitespace-normal text-sm" variant="secondary">
          <Sparkles className="mr-1 h-3 w-3 shrink-0" aria-hidden="true" />
          Trusted by grassroots poker clubs worldwide
        </Badge>
        <h1 className="mb-6 text-4xl font-bold tracking-tight text-foreground sm:text-5xl md:text-6xl lg:text-7xl">
          Run Your Poker Club Like a <span className="text-primary">Pro</span>
        </h1>
        <p className="mx-auto mb-8 max-w-3xl text-lg text-muted-foreground sm:text-xl">
          Stop juggling spreadsheets, text messages, and cash envelopes. {SITE_NAME} handles registrations, payouts,
          leaderboards, and player engagement—so you can focus on hosting epic games.
        </p>
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
          <Button size="lg" className="text-lg" asChild>
            <Link href={routes.register()}>
              Start Free Trial
              <ArrowRight className="ml-2 h-5 w-5" aria-hidden="true" />
            </Link>
          </Button>
          {/* The club directory: real clubs and their tournaments, running on the app. */}
          <Button size="lg" variant="outline" className="text-lg" asChild>
            <Link href={routes.home()}>See It In Action</Link>
          </Button>
        </div>
        <p className="mt-6 text-sm text-muted-foreground">Free for up to 9 players • No credit card required</p>
      </div>

      <div className="mx-auto mt-16 max-w-6xl">
        <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/5 to-primary/10 p-4 shadow-2xl sm:p-8">
          <div className="grid gap-4 md:grid-cols-3">
            {HERO_STATS.map((stat, index) => {
              const Icon = stat.icon;
              return (
                <Card
                  key={stat.label}
                  className="animate-fade-in-up border-primary/20 shadow-lg motion-reduce:animate-none motion-reduce:opacity-100"
                  style={{ animationDelay: `${(index + 1) / 10}s` }}
                >
                  <CardContent className="p-6">
                    <div className="mb-4 flex items-center gap-3">
                      <div className={`rounded-full p-3 ${TONE_CLASSES[stat.tone].tile}`}>
                        <Icon className={`h-6 w-6 ${TONE_CLASSES[stat.tone].icon}`} aria-hidden="true" />
                      </div>
                      <div className="text-3xl font-bold text-foreground">{stat.value}</div>
                    </div>
                    <p className="text-sm text-muted-foreground">{stat.label}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
