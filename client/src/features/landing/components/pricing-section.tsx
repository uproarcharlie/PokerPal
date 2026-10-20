import { Link } from "wouter";
import { Award, CheckCircle2, Star } from "lucide-react";
import { routes } from "@/app/routes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { PLANS, type Plan } from "../content";

function PlanCard({ plan }: { plan: Plan }) {
  const highlighted = plan.highlight?.tone === "primary";
  return (
    <Card className={cn("relative border-2", highlighted && "border-primary shadow-xl", plan.highlight?.tone === "warning" && "border-accent/50")}>
      {plan.highlight ? (
        <div className="absolute -top-4 left-0 right-0 mx-auto w-fit">
          <Badge className={cn("px-3 py-1", plan.highlight.tone === "warning" ? "bg-accent text-accent-foreground hover:bg-accent" : "bg-primary")}>
            {plan.highlight.tone === "warning" ? <Star className="mr-1 h-3 w-3" aria-hidden="true" /> : null}
            {plan.highlight.label}
          </Badge>
        </div>
      ) : null}
      <CardContent className="p-6 sm:p-8">
        <div className="mb-6">
          <h3 className="mb-2 text-2xl font-bold text-foreground">{plan.name}</h3>
          <p className="text-sm text-muted-foreground">{plan.summary}</p>
        </div>
        <div className="mb-6">
          <div className="flex items-baseline gap-1">
            <span className="text-4xl font-bold text-foreground">{plan.price}</span>
            {plan.per ? <span className="text-muted-foreground">{plan.per}</span> : null}
          </div>
          <p className={cn("text-sm", plan.noteIsSaving ? "font-semibold text-chart-4" : "text-muted-foreground")}>{plan.note}</p>
        </div>
        <Button className="w-full" variant={highlighted ? "default" : "outline"} asChild>
          <Link href={routes.register()}>{plan.cta}</Link>
        </Button>
        <ul role="list" className="mt-8 space-y-3 text-sm text-foreground">
          {plan.features.map((feature, index) => (
            <li key={feature} className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-chart-4" aria-hidden="true" />
              <span className={cn(plan.firstFeatureBold && index === 0 && "font-semibold")}>{feature}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** The three plans. */
export function PricingSection() {
  return (
    <section className="border-y border-border bg-muted/50 py-16 sm:py-20">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-5xl">
          <div className="mb-16 text-center">
            <Badge className="mb-4" variant="outline">
              <Award className="mr-1 h-3 w-3" aria-hidden="true" />
              Simple Pricing
            </Badge>
            <h2 className="mb-4 text-3xl font-bold text-foreground sm:text-4xl">Start free, scale as you grow</h2>
            <p className="text-lg text-muted-foreground">No hidden fees. Cancel anytime.</p>
          </div>
          <div className="grid gap-10 lg:grid-cols-3 lg:gap-8">
            {PLANS.map((plan) => (
              <PlanCard key={plan.name} plan={plan} />
            ))}
          </div>
          <p className="mt-8 text-center text-sm text-muted-foreground">All plans include a 14-day free trial. No credit card required.</p>
        </div>
      </div>
    </section>
  );
}
