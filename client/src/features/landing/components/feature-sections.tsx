import type { ReactNode } from "react";
import { CheckCircle2, ChevronRight, X, Zap } from "lucide-react";
import { SITE_NAME } from "@/app/page-meta";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { BENEFITS, FEATURES, PROBLEMS, PROOF, TONE_CLASSES } from "../content";

function SectionHeading({ title, lead, badge }: { title: string; lead: string; badge?: ReactNode }) {
  return (
    <div className="mb-12 text-center sm:mb-16">
      {badge}
      <h2 className="mb-4 text-3xl font-bold text-foreground sm:text-4xl">{title}</h2>
      <p className="text-lg text-muted-foreground">{lead}</p>
    </div>
  );
}

/** What running a club by hand is like. */
export function ProblemSection() {
  return (
    <section className="border-y border-border bg-muted/50 py-16 sm:py-20">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="mb-4 text-3xl font-bold text-foreground sm:text-4xl">Running a poker club shouldn&apos;t be this hard</h2>
          <p className="text-lg text-muted-foreground">
            You&apos;re passionate about poker, not admin work. Yet you&apos;re stuck managing everything manually:
          </p>
          <ul role="list" className="mt-12 grid gap-6 text-left sm:grid-cols-2">
            {PROBLEMS.map((problem) => (
              <li key={problem.title} className="flex gap-3">
                <X className="mt-1 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                <div>
                  <p className="font-semibold text-foreground">{problem.title}</p>
                  <p className="text-sm text-muted-foreground">{problem.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** The four things the app does, each with three examples. */
export function FeaturesSection() {
  return (
    <section className="container mx-auto px-4 py-16 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          title="Everything you need to grow your club"
          lead="Built specifically for grassroots poker clubs"
          badge={
            <Badge className="mb-4" variant="outline">
              <Zap className="mr-1 h-3 w-3" aria-hidden="true" />
              Powerful Features
            </Badge>
          }
        />
        <div className="grid gap-8 md:grid-cols-2">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            const tone = TONE_CLASSES[feature.tone];
            return (
              <Card key={feature.title} className="group relative overflow-hidden border-2 transition-all hover:border-primary hover:shadow-xl">
                <CardContent className="p-6 sm:p-8">
                  <div className={`mb-4 inline-flex rounded-xl p-4 transition-all group-hover:scale-110 motion-reduce:transform-none ${tone.tile}`}>
                    <Icon className={`h-8 w-8 ${tone.icon}`} aria-hidden="true" />
                  </div>
                  <h3 className="mb-3 text-2xl font-bold text-foreground">{feature.title}</h3>
                  <p className="mb-4 text-muted-foreground">{feature.body}</p>
                  <ul role="list" className="space-y-2 text-sm text-foreground">
                    {feature.points.map((point) => (
                      <li key={point} className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-chart-4" aria-hidden="true" />
                        {point}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** The headline numbers. */
export function ProofSection() {
  return (
    <section className="border-y border-border bg-muted/50 py-16 sm:py-20">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-5xl">
          <SectionHeading title={`Why clubs love ${SITE_NAME}`} lead="The data doesn't lie—organized clubs grow faster" />
          <dl className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {PROOF.map((item) => (
              <div key={item.value} className="flex flex-col-reverse text-center">
                <dt className="text-sm text-muted-foreground">{item.label}</dt>
                <dd className="mb-2 text-4xl font-bold text-primary">{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

/** What a club gets out of it: community and time. */
export function BenefitsSection() {
  return (
    <section className="container mx-auto px-4 py-16 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <SectionHeading title="Grow your club on autopilot" lead="Happy players become loyal players—and loyal players bring friends" />
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          {BENEFITS.map((benefit) => {
            const Icon = benefit.icon;
            const tone = TONE_CLASSES[benefit.tone];
            return (
              <div key={benefit.title}>
                <div className={`mb-6 inline-flex rounded-xl p-4 ${tone.tile}`}>
                  <Icon className={`h-8 w-8 ${tone.icon}`} aria-hidden="true" />
                </div>
                <h3 className="mb-3 text-2xl font-bold text-foreground">{benefit.title}</h3>
                <p className="mb-6 text-muted-foreground">{benefit.body}</p>
                <ul role="list" className="space-y-3">
                  {benefit.points.map((point) => (
                    <li key={point.title} className="flex gap-3">
                      <ChevronRight className={`mt-1 h-5 w-5 shrink-0 ${tone.icon}`} aria-hidden="true" />
                      <div>
                        <p className="font-semibold text-foreground">{point.title}</p>
                        <p className="text-sm text-muted-foreground">{point.detail}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
