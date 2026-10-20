/**
 * The marketing page's words, kept apart from its layout so the copy can change without touching
 * markup. Colours are named by tone and mapped to theme tokens in the sections.
 */
import { BarChart3, Calendar, Clock, DollarSign, Smartphone, Target, TrendingUp, Trophy, Users, type LucideIcon } from "lucide-react";

export type Tone = "primary" | "success" | "info" | "warning";

export const TONE_CLASSES: Readonly<Record<Tone, { tile: string; icon: string }>> = {
  primary: { tile: "bg-primary/10 group-hover:bg-primary/20", icon: "text-primary" },
  success: { tile: "bg-chart-4/10 group-hover:bg-chart-4/20", icon: "text-chart-4" },
  info: { tile: "bg-secondary/10 group-hover:bg-secondary/20", icon: "text-secondary" },
  warning: { tile: "bg-accent/10 group-hover:bg-accent/20", icon: "text-accent" },
};

export const HERO_STATS: ReadonlyArray<{ icon: LucideIcon; value: string; label: string; tone: Tone }> = [
  { icon: Users, value: "156", label: "Active Players", tone: "primary" },
  { icon: Trophy, value: "24", label: "Tournaments", tone: "success" },
  { icon: TrendingUp, value: "+43%", label: "Growth Rate", tone: "info" },
];

export const PROBLEMS: ReadonlyArray<{ title: string; detail: string }> = [
  { title: "Chasing payments", detail: "Tracking who paid, who owes, calculating splits" },
  { title: "Manual registrations", detail: "Group chats, spreadsheets, last-minute dropouts" },
  { title: "Lost players", detail: "No way to stay connected between games" },
  { title: "Time wasted", detail: "Hours spent on admin instead of playing" },
];

export const FEATURES: ReadonlyArray<{ icon: LucideIcon; tone: Tone; title: string; body: string; points: readonly string[] }> = [
  {
    icon: Calendar,
    tone: "primary",
    title: "Instant Tournament Setup",
    body: "Create tournaments in 60 seconds. Set buy-ins, rebuys, add-ons, rake, and custom payout structures. Players register with one tap.",
    points: ["QR code registration", "Automatic reminders", "Waitlist management"],
  },
  {
    icon: DollarSign,
    tone: "success",
    title: "Automatic Prize Calculations",
    body: "Lock the prize pool at any time. LovePoker.club calculates payouts, rake, and high hands instantly. No more calculator errors at 2am.",
    points: ["Multiple payout structures", "Rake tracking & reporting", "High hand jackpots"],
  },
  {
    icon: BarChart3,
    tone: "info",
    title: "Season Leaderboards & Points",
    body: "Drive engagement with seasonal competitions. Configurable points systems reward consistency and skill. Players come back to climb the ranks.",
    points: ["Custom points allocation", "Real-time leaderboards", "Participation points"],
  },
  {
    icon: Smartphone,
    tone: "warning",
    title: "Mobile-First Experience",
    body: "Players use their phones. You use any device. Live updates during tournaments keep everyone informed about eliminations, rebuys, and standings.",
    points: ["Live tournament tracking", "Player action buttons", "Public club pages"],
  },
];

export const PROOF: ReadonlyArray<{ value: string; label: string }> = [
  { value: "3.5x", label: "More players return to organized clubs" },
  { value: "67%", label: "Increase in player retention with leaderboards" },
  { value: "5hrs", label: "Saved per tournament on admin work" },
  { value: "98%", label: "Clubs report smoother payment collection" },
];

export const BENEFITS: ReadonlyArray<{ icon: LucideIcon; tone: Tone; title: string; body: string; points: ReadonlyArray<{ title: string; detail: string }> }> = [
  {
    icon: Target,
    tone: "primary",
    title: "Build a competitive community",
    body: "Players see their stats, track their progress, and compete for seasonal championships. Engaged players play more often and bring friends.",
    points: [
      { title: "Player profiles & history", detail: "Every player gets their own profile with complete tournament history" },
      { title: "Seasonal competitions", detail: "Create seasons with championships and prizes" },
      { title: "Public club pages", detail: "Share your club page and let new players discover you" },
    ],
  },
  {
    icon: Clock,
    tone: "success",
    title: "Save hours every week",
    body: "Stop being the club's unpaid accountant. Automation handles the boring stuff so you can focus on creating memorable experiences.",
    points: [
      { title: "No more spreadsheets", detail: "All tournament data captured and calculated automatically" },
      { title: "Instant payout calculations", detail: "Lock prize pool and see exactly who gets paid what" },
      { title: "One-tap registrations", detail: "QR codes and mobile links make sign-ups effortless" },
    ],
  },
];

export interface Plan {
  name: string;
  summary: string;
  price: string;
  /** Beside the price, e.g. "/month". */
  per?: string;
  note: string;
  /** The note reads as a saving. */
  noteIsSaving?: boolean;
  cta: string;
  highlight?: { label: string; tone: "primary" | "warning" };
  features: readonly string[];
  /** The first feature is a heading for the rest ("Everything in Monthly"). */
  firstFeatureBold?: boolean;
}

export const PLANS: readonly Plan[] = [
  {
    name: "Home Game",
    summary: "Perfect for casual games with friends",
    price: "Free",
    note: "Forever",
    cta: "Start Free",
    features: ["Up to 9 players per tournament", "Unlimited tournaments", "Basic prize calculations", "QR code registration"],
  },
  {
    name: "Club Monthly",
    summary: "For growing clubs running regular games",
    price: "$10",
    per: "/month",
    note: "+ $2 per unique player",
    cta: "Start Free Trial",
    highlight: { label: "Most Popular", tone: "primary" },
    features: [
      "Unlimited players",
      "Unlimited tournaments",
      "Season leaderboards",
      "Custom points systems",
      "High hand tracking",
      "Public club page",
      "Player profiles & stats",
    ],
  },
  {
    name: "Club Lifetime",
    summary: "One payment, lifetime access",
    price: "$300",
    per: "once",
    note: "Save over $1,000 vs monthly",
    noteIsSaving: true,
    cta: "Get Lifetime Access",
    highlight: { label: "Best Value", tone: "warning" },
    features: ["Everything in Monthly", "No recurring fees ever", "Priority support", "All future features included", "Locked-in forever pricing"],
    firstFeatureBold: true,
  },
];

export const STEPS: ReadonlyArray<{ title: string; body: string }> = [
  { title: "Create Your Club", body: "Sign up free, add your club details, and customize your settings in under 2 minutes." },
  { title: "Launch a Tournament", body: "Set your buy-in, structure, and payouts. Share the QR code or link with your players." },
  { title: "Watch It Run Itself", body: "Track everything live. Lock prize pool with one click. Players see results instantly." },
];
