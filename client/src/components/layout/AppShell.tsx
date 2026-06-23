import { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { motion } from "framer-motion";
import ConnectionStatus from "./ConnectionStatus";
import UnitSwitcher from "./UnitSwitcher";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

const I = (paths: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {paths}
  </svg>
);

const NAV: NavItem[] = [
  { to: "/", label: "Live", icon: I(<><path d="M2 11h3l2-6 3 12 2.5-8 1.5 4h4" /></>) },
  { to: "/trends", label: "Trends", icon: I(<><path d="M3 16l5-6 3 3 6-8" /><path d="M3 3v14h14" /></>) },
  { to: "/diagnostics", label: "Diagnostics", icon: I(<><circle cx="9" cy="9" r="6" /><path d="M13.5 13.5L18 18" /></>) },
  { to: "/export", label: "Export", icon: I(<><path d="M10 3v9" /><path d="M6.5 8.5L10 12l3.5-3.5" /><path d="M4 16h12" /></>) },
  { to: "/calibrated", label: "Calibrated", icon: I(<><path d="M4 10h12" /><circle cx="8" cy="10" r="2.2" /><path d="M3 5h14M3 15h14" /></>) },
];

const linkBase =
  "relative flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors";

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full">
      {/* ── Top bar ── */}
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-ink-900/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <BrandMark />
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-tight text-slate-100">
                Biogas Monitor
              </div>
              <div className="text-[0.65rem] uppercase tracking-[0.2em] text-signal-dim">
                analyzer
              </div>
            </div>
          </div>

          {/* Desktop nav */}
          <nav className="ml-2 hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  `${linkBase} ${
                    isActive
                      ? "text-signal-glow"
                      : "text-slate-400 hover:text-slate-200"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <motion.span
                        layoutId="nav-active"
                        className="absolute inset-0 rounded-lg bg-signal/10 ring-1 ring-signal/25"
                        transition={{ type: "spring", stiffness: 400, damping: 32 }}
                      />
                    )}
                    <span className="relative">{item.icon}</span>
                    <span className="relative">{item.label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <ConnectionStatus />
          </div>
          <div className="w-full md:ml-auto md:w-auto">
            <UnitSwitcher />
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="mx-auto max-w-7xl px-4 pb-28 pt-5 sm:px-6 md:pb-12">
        {children}
      </main>

      {/* ── Mobile bottom tab bar ── */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-white/[0.06] bg-ink-900/90 backdrop-blur-md md:hidden">
        <div className="flex items-stretch justify-around">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-1 py-2.5 text-[0.62rem] font-medium transition-colors ${
                  isActive ? "text-signal-glow" : "text-slate-500"
                }`
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

function BrandMark() {
  return (
    <div className="grid h-9 w-9 place-items-center rounded-xl bg-signal/10 ring-1 ring-signal/30">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5cffe0" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 14h4l2.5-7 3.5 13 3-9 2 3h5" />
      </svg>
    </div>
  );
}
