import { CallToActionSection, LandingFooter, StepsSection } from "../components/closing-sections";
import { BenefitsSection, FeaturesSection, ProblemSection, ProofSection } from "../components/feature-sections";
import { HeroSection } from "../components/hero-section";
import { LandingHeader } from "../components/landing-header";
import { PricingSection } from "../components/pricing-section";

/** The platform's marketing page at "/": what it does for a club, the plans, and the ways in. */
export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-gradient-to-b from-background to-muted/20 text-foreground">
      <LandingHeader />
      <HeroSection />
      <ProblemSection />
      <FeaturesSection />
      <ProofSection />
      <BenefitsSection />
      <PricingSection />
      <StepsSection />
      <CallToActionSection />
      <LandingFooter />
    </div>
  );
}
