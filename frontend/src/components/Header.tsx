"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import { Moon, Sun } from "lucide-react";
import { CompanySwitcher } from "@/components/company-switcher";
import { UserMenu } from "@/components/user-menu";

const NAV_LINKS = [
  { href: "/datasets", label: "Datasets" },
  { href: "/transform", label: "Transform" },
  { href: "/modeling", label: "Modeling" },
  { href: "/analysis", label: "Analysis" },
  { href: "/predict", label: "Predict" },
];

const NavLink = ({ href, label, layoutScope }: { href: string; label: string; layoutScope: string }) => {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href === "/" ? "/" : href);
  return (
    <Link href={href} className="relative px-3 py-1 rounded-full text-sm">
      {active && (
        <motion.span
          layoutId={`nav-active-pill-${layoutScope}`}
          className="absolute inset-0 rounded-full bg-[var(--color-accent-soft)]"
          transition={{ type: "spring", stiffness: 500, damping: 35 }}
        />
      )}
      <span
        className={clsx(
          "relative z-10 transition-colors",
          active ? "text-[var(--color-accent)]" : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
        )}
      >
        {label}
      </span>
    </Link>
  );
};

const ThemeToggle = () => {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  return (
    <button
      aria-label="Toggle theme"
      className="p-2 rounded-full border border-[var(--color-border)] hover:bg-[var(--color-accent-soft)] transition-colors"
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
};

export default function Header() {
  const [shrunken, setShrunken] = useState(false);

  useEffect(() => {
    let frame: number;
    const handleScroll = () => {
      frame = requestAnimationFrame(() => {
        setShrunken(window.scrollY > 12);
      });
    };
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return (
    <header
      className={clsx(
        "no-print sticky top-0 z-50 backdrop-blur transition-all border-b border-transparent",
        "bg-[color:rgba(248,250,252,0.85)] dark:bg-[rgba(2,6,23,0.85)]",
        shrunken ? "py-2 shadow-sm" : "py-4"
      )}
    >
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/datasets" className="font-semibold tracking-tight text-lg">
            Aion
          </Link>
          <nav className="hidden md:flex items-center gap-2">
            {NAV_LINKS.map((link) => (
              <NavLink key={link.href} {...link} layoutScope="desktop" />
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <CompanySwitcher />
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
      <nav className="md:hidden px-6 mt-3 flex items-center gap-2 overflow-x-auto">
        {NAV_LINKS.map((link) => (
          <NavLink key={`mobile-${link.href}`} {...link} layoutScope="mobile" />
        ))}
      </nav>
    </header>
  );
}
