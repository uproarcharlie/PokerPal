import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Calendar,
  ChartLine,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Shield,
  Trophy,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { routes } from "@/app/routes";
import { PlayerAvatar } from "@/components/image/player-avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/contexts/auth-context";
import { BrandMark } from "@/features/landing/components/brand-mark";
import { roleLabel } from "@/features/users/roles";
import { cn } from "@/lib/utils";

interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  /** Other paths under which this entry is the current one (a tournament's desk pages, for Tournaments). */
  alsoUnder?: readonly string[];
  adminOnly?: boolean;
}

const NAV_ITEMS: readonly NavItem[] = [
  { name: "Dashboard", href: routes.dashboard(), icon: LayoutDashboard },
  { name: "Clubs", href: routes.clubs(), icon: Users },
  { name: "Seasons", href: routes.seasons(), icon: Calendar },
  { name: "Tournaments", href: routes.tournaments(), icon: Trophy, alsoUnder: ["/admin/"] },
  { name: "Leaderboards", href: routes.leaderboards(), icon: ChartLine },
  { name: "Players", href: routes.players(), icon: UsersRound },
  { name: "Users", href: routes.users(), icon: Shield, adminOnly: true },
  { name: "Settings", href: routes.settings(), icon: Settings },
];

/** Whether `item` is the section `location` is in: its page, any page under it, or one of its other paths. */
function isCurrentSection(item: Pick<NavItem, "href" | "alsoUnder">, location: string): boolean {
  if (location === item.href || location.startsWith(`${item.href}/`)) return true;
  return item.alsoUnder?.some((prefix) => location.startsWith(prefix)) ?? false;
}

/**
 * The staff screens' navigation: a fixed column from laptop width, and on a phone a header with a menu
 * button that opens the same column as a drawer (focus stays inside it while open, Escape closes it, and
 * nothing in it can be reached while it is closed). Heights use `dvh`, so the account menu and Log out
 * are never hidden behind a phone browser's toolbar.
 */
export function Sidebar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <header className="fixed inset-x-0 top-0 z-40 flex h-[57px] items-center justify-between border-b border-border bg-card px-4 lg:hidden">
          <Link href={routes.staffHome()} className="min-w-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <BrandMark size="md" nameClassName="text-sm" />
          </Link>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open menu">
              <Menu className="h-5 w-5" aria-hidden="true" />
            </Button>
          </SheetTrigger>
        </header>
        <SheetContent side="left" aria-describedby={undefined} className="flex h-dvh w-72 max-w-[85vw] flex-col gap-0 p-0">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SidebarContent onNavigate={closeMenu} inDrawer />
        </SheetContent>
      </Sheet>

      <aside className="hidden h-dvh w-64 shrink-0 flex-col border-r border-border bg-card lg:flex">
        <SidebarContent />
      </aside>
    </>
  );
}

/**
 * The column's contents. In the phone drawer the links carry no test ids: the laptop column is in the
 * page too (hidden by CSS), and an id must name one element.
 */
function SidebarContent({ onNavigate, inDrawer = false }: { onNavigate?: () => void; inDrawer?: boolean }) {
  const [location] = useLocation();
  const { isAdmin } = useAuth();
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  return (
    <>
      <div className="shrink-0 border-b border-border p-6">
        <Link
          href={routes.staffHome()}
          onClick={onNavigate}
          className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <BrandMark size="lg" nameClassName="text-lg" />
          <span className="mt-1 block text-xs text-muted-foreground">Where Communities Thrive</span>
        </Link>
      </div>

      <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto p-4">
        <ul role="list" className="space-y-1">
          {items.map((item) => {
            const current = isCurrentSection(item, location);
            const Icon = item.icon;
            return (
              <li key={item.name}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={current ? "page" : undefined}
                  data-testid={inDrawer ? undefined : `nav-${item.name.toLowerCase()}`}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    current ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted",
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  <span>{item.name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="shrink-0 px-4 pb-2">
        <ThemeToggle />
      </div>

      <div className="shrink-0 border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <AccountMenu onNavigate={onNavigate} />
      </div>
    </>
  );
}

function AccountMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <PlayerAvatar name={user.name} imageUrl={user.imageUrl} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">{user.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{roleLabel(user.role)}</span>
          </span>
          <Settings className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>My Account</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={routes.settings()} onClick={onNavigate}>
            <Settings className="mr-2 h-4 w-4" aria-hidden="true" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* Signed out, the staff layout sends the visitor to the sign-in page. */}
        <DropdownMenuItem onSelect={() => void logout()}>
          <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
