import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import {
  Trophy,
  Users,
  Calendar,
  TrendingUp,
  DollarSign,
  BarChart3,
  Clock,
  Smartphone,
  CheckCircle2,
  Zap,
  Target,
  Award,
  Shield,
  ArrowRight,
  Star,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function LandingPage() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <img
              src="/assets/icon.png"
              alt="LovePoker.club"
              className="h-8 w-8 rounded-lg object-contain"
            />
            <span className="text-xl font-bold">LovePoker.club</span>
          </div>
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => setLocation("/login")}>
              Log In
            </Button>
            <Button onClick={() => setLocation("/register")}>
              Get Started Free
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20 lg:py-32">
        <div className="mx-auto max-w-5xl text-center">
          <Badge className="mb-4 text-sm" variant="secondary">
            <Sparkles className="mr-1 h-3 w-3" />
            Trusted by grassroots poker clubs worldwide
          </Badge>
          <h1 className="mb-6 text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
            Run Your Poker Club Like a{" "}
            <span className="text-primary">Pro</span>
          </h1>
          <p className="mx-auto mb-8 max-w-3xl text-lg text-muted-foreground sm:text-xl">
            Stop juggling spreadsheets, text messages, and cash envelopes.
            PokerPal handles registrations, payouts, leaderboards, and player
            engagement—so you can focus on hosting epic games.
          </p>
          <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
            <Button size="lg" className="text-lg" onClick={() => setLocation("/register")}>
              Start Free Trial
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
            <Button size="lg" variant="outline" className="text-lg">
              See It In Action
            </Button>
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            Free for up to 9 players • No credit card required
          </p>
        </div>

        {/* Hero Visual - Animated Cards */}
        <div className="mx-auto mt-16 max-w-6xl">
          <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/5 to-primary/10 p-8 shadow-2xl">
            <div className="grid gap-4 md:grid-cols-3">
              <Card className="animate-fade-in-up border-primary/20 shadow-lg" style={{ animationDelay: "0.1s" }}>
                <CardContent className="p-6">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="rounded-full bg-primary/10 p-3">
                      <Users className="h-6 w-6 text-primary" />
                    </div>
                    <div className="text-3xl font-bold">156</div>
                  </div>
                  <p className="text-sm text-muted-foreground">Active Players</p>
                </CardContent>
              </Card>
              <Card className="animate-fade-in-up border-primary/20 shadow-lg" style={{ animationDelay: "0.2s" }}>
                <CardContent className="p-6">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="rounded-full bg-green-500/10 p-3">
                      <Trophy className="h-6 w-6 text-green-500" />
                    </div>
                    <div className="text-3xl font-bold">24</div>
                  </div>
                  <p className="text-sm text-muted-foreground">Tournaments</p>
                </CardContent>
              </Card>
              <Card className="animate-fade-in-up border-primary/20 shadow-lg" style={{ animationDelay: "0.3s" }}>
                <CardContent className="p-6">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="rounded-full bg-blue-500/10 p-3">
                      <TrendingUp className="h-6 w-6 text-blue-500" />
                    </div>
                    <div className="text-3xl font-bold">+43%</div>
                  </div>
                  <p className="text-sm text-muted-foreground">Growth Rate</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* Problem Section */}
      <section className="border-y bg-muted/50 py-20">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="mb-4 text-3xl font-bold sm:text-4xl">
              Running a poker club shouldn't be this hard
            </h2>
            <p className="text-lg text-muted-foreground">
              You're passionate about poker, not admin work. Yet you're stuck
              managing everything manually:
            </p>
            <div className="mt-12 grid gap-6 text-left sm:grid-cols-2">
              <div className="flex gap-3">
                <div className="mt-1 text-red-500">✗</div>
                <div>
                  <p className="font-semibold">Chasing payments</p>
                  <p className="text-sm text-muted-foreground">
                    Tracking who paid, who owes, calculating splits
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="mt-1 text-red-500">✗</div>
                <div>
                  <p className="font-semibold">Manual registrations</p>
                  <p className="text-sm text-muted-foreground">
                    Group chats, spreadsheets, last-minute dropouts
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="mt-1 text-red-500">✗</div>
                <div>
                  <p className="font-semibold">Lost players</p>
                  <p className="text-sm text-muted-foreground">
                    No way to stay connected between games
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="mt-1 text-red-500">✗</div>
                <div>
                  <p className="font-semibold">Time wasted</p>
                  <p className="text-sm text-muted-foreground">
                    Hours spent on admin instead of playing
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-4 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-16 text-center">
            <Badge className="mb-4" variant="outline">
              <Zap className="mr-1 h-3 w-3" />
              Powerful Features
            </Badge>
            <h2 className="mb-4 text-3xl font-bold sm:text-4xl">
              Everything you need to grow your club
            </h2>
            <p className="text-lg text-muted-foreground">
              Built specifically for grassroots poker clubs
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-2">
            {/* Feature 1 */}
            <Card className="group relative overflow-hidden border-2 transition-all hover:border-primary hover:shadow-xl">
              <CardContent className="p-8">
                <div className="mb-4 inline-flex rounded-xl bg-primary/10 p-4 transition-all group-hover:scale-110 group-hover:bg-primary/20">
                  <Calendar className="h-8 w-8 text-primary" />
                </div>
                <h3 className="mb-3 text-2xl font-bold">
                  Instant Tournament Setup
                </h3>
                <p className="mb-4 text-muted-foreground">
                  Create tournaments in 60 seconds. Set buy-ins, rebuys,
                  add-ons, rake, and custom payout structures. Players register
                  with one tap.
                </p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    QR code registration
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    Automatic reminders
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    Waitlist management
                  </li>
                </ul>
              </CardContent>
            </Card>

            {/* Feature 2 */}
            <Card className="group relative overflow-hidden border-2 transition-all hover:border-primary hover:shadow-xl">
              <CardContent className="p-8">
                <div className="mb-4 inline-flex rounded-xl bg-green-500/10 p-4 transition-all group-hover:scale-110 group-hover:bg-green-500/20">
                  <DollarSign className="h-8 w-8 text-green-500" />
                </div>
                <h3 className="mb-3 text-2xl font-bold">
                  Automatic Prize Calculations
                </h3>
                <p className="mb-4 text-muted-foreground">
                  Lock the prize pool at any time. PokerPal calculates payouts,
                  rake, and high hands instantly. No more calculator errors at
                  2am.
                </p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    Multiple payout structures
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    Rake tracking & reporting
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    High hand jackpots
                  </li>
                </ul>
              </CardContent>
            </Card>

            {/* Feature 3 */}
            <Card className="group relative overflow-hidden border-2 transition-all hover:border-primary hover:shadow-xl">
              <CardContent className="p-8">
                <div className="mb-4 inline-flex rounded-xl bg-blue-500/10 p-4 transition-all group-hover:scale-110 group-hover:bg-blue-500/20">
                  <BarChart3 className="h-8 w-8 text-blue-500" />
                </div>
                <h3 className="mb-3 text-2xl font-bold">
                  Season Leaderboards & Points
                </h3>
                <p className="mb-4 text-muted-foreground">
                  Drive engagement with seasonal competitions. Configurable
                  points systems reward consistency and skill. Players come back
                  to climb the ranks.
                </p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    Custom points allocation
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    Real-time leaderboards
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    Participation points
                  </li>
                </ul>
              </CardContent>
            </Card>

            {/* Feature 4 */}
            <Card className="group relative overflow-hidden border-2 transition-all hover:border-primary hover:shadow-xl">
              <CardContent className="p-8">
                <div className="mb-4 inline-flex rounded-xl bg-orange-500/10 p-4 transition-all group-hover:scale-110 group-hover:bg-orange-500/20">
                  <Smartphone className="h-8 w-8 text-orange-500" />
                </div>
                <h3 className="mb-3 text-2xl font-bold">
                  Mobile-First Experience
                </h3>
                <p className="mb-4 text-muted-foreground">
                  Players use their phones. You use any device. Live updates
                  during tournaments keep everyone informed about eliminations,
                  rebuys, and standings.
                </p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    Live tournament tracking
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    Player action buttons
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    Public club pages
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Stats/Social Proof Section */}
      <section className="border-y bg-muted/50 py-20">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-5xl">
            <div className="mb-12 text-center">
              <h2 className="mb-4 text-3xl font-bold">
                Why clubs love PokerPal
              </h2>
              <p className="text-lg text-muted-foreground">
                The data doesn't lie—organized clubs grow faster
              </p>
            </div>
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              <div className="text-center">
                <div className="mb-2 text-4xl font-bold text-primary">3.5x</div>
                <p className="text-sm text-muted-foreground">
                  More players return to organized clubs
                </p>
              </div>
              <div className="text-center">
                <div className="mb-2 text-4xl font-bold text-primary">67%</div>
                <p className="text-sm text-muted-foreground">
                  Increase in player retention with leaderboards
                </p>
              </div>
              <div className="text-center">
                <div className="mb-2 text-4xl font-bold text-primary">5hrs</div>
                <p className="text-sm text-muted-foreground">
                  Saved per tournament on admin work
                </p>
              </div>
              <div className="text-center">
                <div className="mb-2 text-4xl font-bold text-primary">98%</div>
                <p className="text-sm text-muted-foreground">
                  Clubs report smoother payment collection
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="container mx-auto px-4 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-3xl font-bold sm:text-4xl">
              Grow your club on autopilot
            </h2>
            <p className="text-lg text-muted-foreground">
              Happy players become loyal players—and loyal players bring friends
            </p>
          </div>

          <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <div className="mb-6 inline-flex rounded-xl bg-primary/10 p-4">
                <Target className="h-8 w-8 text-primary" />
              </div>
              <h3 className="mb-3 text-2xl font-bold">
                Build a competitive community
              </h3>
              <p className="mb-6 text-muted-foreground">
                Players see their stats, track their progress, and compete for
                seasonal championships. Engaged players play more often and
                bring friends.
              </p>
              <ul className="space-y-3">
                <li className="flex gap-3">
                  <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-primary" />
                  <div>
                    <p className="font-semibold">Player profiles & history</p>
                    <p className="text-sm text-muted-foreground">
                      Every player gets their own profile with complete tournament history
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-primary" />
                  <div>
                    <p className="font-semibold">Seasonal competitions</p>
                    <p className="text-sm text-muted-foreground">
                      Create seasons with championships and prizes
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-primary" />
                  <div>
                    <p className="font-semibold">Public club pages</p>
                    <p className="text-sm text-muted-foreground">
                      Share your club page and let new players discover you
                    </p>
                  </div>
                </li>
              </ul>
            </div>

            <div>
              <div className="mb-6 inline-flex rounded-xl bg-green-500/10 p-4">
                <Clock className="h-8 w-8 text-green-500" />
              </div>
              <h3 className="mb-3 text-2xl font-bold">
                Save hours every week
              </h3>
              <p className="mb-6 text-muted-foreground">
                Stop being the club's unpaid accountant. Automation handles the
                boring stuff so you can focus on creating memorable experiences.
              </p>
              <ul className="space-y-3">
                <li className="flex gap-3">
                  <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-green-500" />
                  <div>
                    <p className="font-semibold">No more spreadsheets</p>
                    <p className="text-sm text-muted-foreground">
                      All tournament data captured and calculated automatically
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-green-500" />
                  <div>
                    <p className="font-semibold">Instant payout calculations</p>
                    <p className="text-sm text-muted-foreground">
                      Lock prize pool and see exactly who gets paid what
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-green-500" />
                  <div>
                    <p className="font-semibold">One-tap registrations</p>
                    <p className="text-sm text-muted-foreground">
                      QR codes and mobile links make sign-ups effortless
                    </p>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="border-y bg-muted/50 py-20">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-5xl">
            <div className="mb-16 text-center">
              <Badge className="mb-4" variant="outline">
                <Award className="mr-1 h-3 w-3" />
                Simple Pricing
              </Badge>
              <h2 className="mb-4 text-3xl font-bold sm:text-4xl">
                Start free, scale as you grow
              </h2>
              <p className="text-lg text-muted-foreground">
                No hidden fees. Cancel anytime.
              </p>
            </div>

            <div className="grid gap-8 lg:grid-cols-3">
              {/* Free Plan */}
              <Card className="relative border-2">
                <CardContent className="p-8">
                  <div className="mb-6">
                    <h3 className="mb-2 text-2xl font-bold">Home Game</h3>
                    <p className="text-sm text-muted-foreground">
                      Perfect for casual games with friends
                    </p>
                  </div>
                  <div className="mb-6">
                    <div className="text-4xl font-bold">Free</div>
                    <p className="text-sm text-muted-foreground">Forever</p>
                  </div>
                  <Button className="w-full" variant="outline" onClick={() => setLocation("/register")}>
                    Start Free
                  </Button>
                  <ul className="mt-8 space-y-3 text-sm">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                      <span>Up to 9 players per tournament</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                      <span>Unlimited tournaments</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                      <span>Basic prize calculations</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                      <span>QR code registration</span>
                    </li>
                  </ul>
                </CardContent>
              </Card>

              {/* Monthly Plan */}
              <Card className="relative border-2 border-primary shadow-xl">
                <div className="absolute -top-4 left-0 right-0 mx-auto w-fit">
                  <Badge className="bg-primary px-3 py-1">Most Popular</Badge>
                </div>
                <CardContent className="p-8">
                  <div className="mb-6">
                    <h3 className="mb-2 text-2xl font-bold">Club Monthly</h3>
                    <p className="text-sm text-muted-foreground">
                      For growing clubs running regular games
                    </p>
                  </div>
                  <div className="mb-6">
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-bold">$10</span>
                      <span className="text-muted-foreground">/month</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      + $2 per unique player
                    </p>
                  </div>
                  <Button className="w-full" onClick={() => setLocation("/register")}>
                    Start Free Trial
                  </Button>
                  <ul className="mt-8 space-y-3 text-sm">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                      <span>Unlimited players</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                      <span>Unlimited tournaments</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                      <span>Season leaderboards</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                      <span>Custom points systems</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                      <span>High hand tracking</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                      <span>Public club page</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                      <span>Player profiles & stats</span>
                    </li>
                  </ul>
                </CardContent>
              </Card>

              {/* Lifetime Plan */}
              <Card className="relative border-2 border-yellow-500/50">
                <div className="absolute -top-4 left-0 right-0 mx-auto w-fit">
                  <Badge className="bg-yellow-500 px-3 py-1 text-yellow-950">
                    <Star className="mr-1 h-3 w-3" />
                    Best Value
                  </Badge>
                </div>
                <CardContent className="p-8">
                  <div className="mb-6">
                    <h3 className="mb-2 text-2xl font-bold">Club Lifetime</h3>
                    <p className="text-sm text-muted-foreground">
                      One payment, lifetime access
                    </p>
                  </div>
                  <div className="mb-6">
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-bold">$300</span>
                      <span className="text-muted-foreground">once</span>
                    </div>
                    <p className="text-sm text-green-600 font-semibold">
                      Save over $1,000 vs monthly
                    </p>
                  </div>
                  <Button className="w-full" variant="outline" onClick={() => setLocation("/register")}>
                    Get Lifetime Access
                  </Button>
                  <ul className="mt-8 space-y-3 text-sm">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                      <span className="font-semibold">Everything in Monthly</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                      <span>No recurring fees ever</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                      <span>Priority support</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                      <span>All future features included</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                      <span>Locked-in forever pricing</span>
                    </li>
                  </ul>
                </CardContent>
              </Card>
            </div>

            <p className="mt-8 text-center text-sm text-muted-foreground">
              All plans include a 14-day free trial. No credit card required.
            </p>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="container mx-auto px-4 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-3xl font-bold sm:text-4xl">
              Get started in minutes
            </h2>
            <p className="text-lg text-muted-foreground">
              No complicated setup. Start running better tournaments today.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            <div className="text-center">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-2xl font-bold text-primary">
                1
              </div>
              <h3 className="mb-3 text-xl font-bold">Create Your Club</h3>
              <p className="text-muted-foreground">
                Sign up free, add your club details, and customize your settings
                in under 2 minutes.
              </p>
            </div>
            <div className="text-center">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-2xl font-bold text-primary">
                2
              </div>
              <h3 className="mb-3 text-xl font-bold">Launch a Tournament</h3>
              <p className="text-muted-foreground">
                Set your buy-in, structure, and payouts. Share the QR code or
                link with your players.
              </p>
            </div>
            <div className="text-center">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-2xl font-bold text-primary">
                3
              </div>
              <h3 className="mb-3 text-xl font-bold">Watch It Run Itself</h3>
              <p className="text-muted-foreground">
                Track everything live. Lock prize pool with one click. Players
                see results instantly.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-y bg-primary py-20 text-primary-foreground">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="mb-4 text-3xl font-bold sm:text-4xl">
              Ready to level up your poker club?
            </h2>
            <p className="mb-8 text-lg opacity-90">
              Join hundreds of clubs using PokerPal to run smoother tournaments,
              engage players, and grow their community.
            </p>
            <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
              <Button
                size="lg"
                variant="secondary"
                className="text-lg"
                onClick={() => setLocation("/register")}
              >
                Start Free Trial
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="border-primary-foreground bg-transparent text-lg text-primary-foreground hover:bg-primary-foreground/10"
              >
                Schedule a Demo
              </Button>
            </div>
            <p className="mt-6 text-sm opacity-75">
              Free for up to 9 players • No credit card required • Cancel
              anytime
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-12">
        <div className="container mx-auto px-4">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-2">
              <img
                src="/assets/icon.png"
                alt="LovePoker.club"
                className="h-6 w-6 rounded-lg object-contain"
              />
              <span className="font-semibold">LovePoker.club</span>
            </div>
            <div className="flex gap-6 text-sm text-muted-foreground">
              <a href="#" className="hover:text-foreground">Privacy</a>
              <a href="#" className="hover:text-foreground">Terms</a>
              <a href="#" className="hover:text-foreground">Support</a>
            </div>
          </div>
          <div className="mt-8 text-center text-sm text-muted-foreground">
            © 2025 LovePoker.club. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
