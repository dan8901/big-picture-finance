"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard", icon: "LayoutDashboard" },
  { href: "/upload", label: "Upload", icon: "Upload" },
  { href: "/transactions", label: "Transactions", icon: "List" },
  { href: "/income", label: "Income", icon: "TrendingUp" },
  { href: "/net-worth", label: "Net Worth", icon: "Wallet" },
  { href: "/accounts", label: "Accounts", icon: "Building" },
  { href: "/goals", label: "Goals", icon: "Trophy" },
  { href: "/chat", label: "Chat", icon: "MessageCircle" },
  { href: "/settings", label: "Settings", icon: "Settings" },
];

const icons: Record<string, React.ReactNode> = {
  LayoutDashboard: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>
  ),
  Upload: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
  ),
  List: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>
  ),
  TrendingUp: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
  ),
  Wallet: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/></svg>
  ),
  Building: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg>
  ),
  Trophy: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
  ),
  MessageCircle: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>
  ),
  Settings: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
  ),
  EyeOff: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>
  ),
  ChevronLeft: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
  ),
  ChevronRight: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
  ),
  LogOut: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>
  ),
  Menu: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>
  ),
  X: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
  ),
  Info: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
  ),
};

function NavLink({ item, collapsed, pathname, onClick }: { item: typeof navItems[0]; collapsed: boolean; pathname: string; onClick?: () => void }) {
  return (
    <Link
      key={item.href}
      href={item.href}
      prefetch={false}
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      className={cn(
        "flex items-center rounded-md py-2 text-sm font-medium transition-colors",
        collapsed ? "justify-center px-2" : "gap-3 px-3",
        pathname === item.href
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      )}
    >
      {icons[item.icon]}
      {!collapsed && item.label}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Prevent body scroll when mobile drawer is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const bottomItems = (closeMobile?: () => void) => (
    <div className="border-t p-2 space-y-1">
      <Link
        href="/excluded"
        onClick={closeMobile}
        className={cn(
          "flex items-center rounded-md py-2 text-sm font-medium transition-colors gap-3 px-3",
          pathname === "/excluded"
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        )}
      >
        {icons.EyeOff}
        Excluded
      </Link>
      <Link
        href="/about"
        onClick={closeMobile}
        className={cn(
          "flex items-center rounded-md py-2 text-sm font-medium transition-colors gap-3 px-3",
          pathname === "/about"
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        )}
      >
        {icons.Info}
        About
      </Link>
      <button
        onClick={async () => {
          await fetch("/api/auth", { method: "DELETE" });
          router.push("/login");
        }}
        className={cn(
          "flex items-center rounded-md py-2 text-sm font-medium transition-colors w-full gap-3 px-3",
          "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        )}
      >
        {icons.LogOut}
        Logout
      </button>
    </div>
  );

  return (
    <>
      {/* Mobile header bar */}
      <div className="fixed top-0 left-0 right-0 z-40 flex h-14 items-center border-b bg-background px-4 md:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          {icons.Menu}
        </button>
        <h1 className="ml-3 text-lg font-semibold truncate">Big Picture Finance</h1>
      </div>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        >
          <aside
            className="h-full w-64 bg-background border-r flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-14 items-center border-b px-3 justify-between">
              <h1 className="text-lg font-semibold truncate px-2">Big Picture Finance</h1>
              <button
                onClick={() => setMobileOpen(false)}
                className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                {icons.X}
              </button>
            </div>
            <nav className="flex-1 space-y-1 p-2">
              {navItems.map((item) => (
                <NavLink key={item.href} item={item} collapsed={false} pathname={pathname} onClick={() => setMobileOpen(false)} />
              ))}
            </nav>
            {bottomItems(() => setMobileOpen(false))}
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden md:flex h-screen flex-col border-r bg-background transition-all duration-200",
          collapsed ? "w-16" : "w-64"
        )}
      >
        <div className="flex h-14 items-center border-b px-3 justify-between">
          {!collapsed && (
            <h1 className="text-lg font-semibold truncate px-2">Big Picture Finance</h1>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? icons.ChevronRight : icons.ChevronLeft}
          </button>
        </div>
        <nav className="flex-1 space-y-1 p-2">
          {navItems.map((item) => (
            <NavLink key={item.href} item={item} collapsed={collapsed} pathname={pathname} />
          ))}
        </nav>
        <div className="border-t p-2 space-y-1">
          <Link
            href="/excluded"
            title={collapsed ? "Excluded" : undefined}
            className={cn(
              "flex items-center rounded-md py-2 text-sm font-medium transition-colors",
              collapsed ? "justify-center px-2" : "gap-3 px-3",
              pathname === "/excluded"
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            {icons.EyeOff}
            {!collapsed && "Excluded"}
          </Link>
          <Link
            href="/about"
            title={collapsed ? "About" : undefined}
            className={cn(
              "flex items-center rounded-md py-2 text-sm font-medium transition-colors",
              collapsed ? "justify-center px-2" : "gap-3 px-3",
              pathname === "/about"
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            {icons.Info}
            {!collapsed && "About"}
          </Link>
          <button
            onClick={async () => {
              await fetch("/api/auth", { method: "DELETE" });
              router.push("/login");
            }}
            title={collapsed ? "Logout" : undefined}
            className={cn(
              "flex items-center rounded-md py-2 text-sm font-medium transition-colors w-full",
              collapsed ? "justify-center px-2" : "gap-3 px-3",
              "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            {icons.LogOut}
            {!collapsed && "Logout"}
          </button>
        </div>
      </aside>
    </>
  );
}
