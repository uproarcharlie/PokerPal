import { Link, useLocation } from "wouter";
import { Diamond, LayoutDashboard, Users, Trophy, Calendar, ChartLine, UsersRound, Settings } from "lucide-react";

export function Sidebar() {
  const [location] = useLocation();

  const navigation = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Clubs", href: "/clubs", icon: Users },
    { name: "Tournaments", href: "/tournaments", icon: Trophy },
    { name: "Seasons", href: "/seasons", icon: Calendar },
    { name: "Leaderboards", href: "/leaderboards", icon: ChartLine },
    { name: "Players", href: "/players", icon: UsersRound },
    { name: "Settings", href: "/settings", icon: Settings },
  ];

  return (
    <aside className="w-64 bg-card border-r border-border flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
            <Diamond className="text-primary-foreground text-lg" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">PokerPro</h1>
            <p className="text-xs text-muted-foreground">Tournament Manager</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {navigation.map((item) => {
          const isActive = location === item.href;
          const Icon = item.icon;
          
          return (
            <Link
              key={item.name}
              href={item.href}
              data-testid={`nav-${item.name.toLowerCase()}`}
              className={`flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-muted"
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </nav>

      {/* User Profile */}
      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-sm font-semibold">
            <span>AD</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">Admin</p>
            <p className="text-xs text-muted-foreground truncate">Tournament Manager</p>
          </div>
          <button className="text-muted-foreground hover:text-foreground" data-testid="user-menu">
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
