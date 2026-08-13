"use client";

import React, { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { Menu, Moon, Sun } from "lucide-react";
import { CompanySwitcher } from "@/components/company-switcher";
import { UserMenu } from "@/components/user-menu";
import { IconButton } from "@/components/ui/icon-button";
import { useLocaleToggle } from "@/components/providers/locale-provider";

const ThemeToggle = () => {
  const { resolvedTheme, setTheme } = useTheme();
  // `resolvedTheme` is undefined on the server (and on the client's first render, before
  // next-themes reads localStorage) — rendering off it directly causes a real hydration
  // mismatch whenever the stored preference is "dark" (SSR always assumes light). Render a
  // theme-agnostic placeholder until mounted, then swap to the real icon.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === "dark";
  return (
    <IconButton aria-label="Toggle theme" onClick={() => setTheme(isDark ? "light" : "dark")}>
      {mounted ? isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" /> : <Moon className="h-4 w-4 opacity-0" />}
    </IconButton>
  );
};

const LanguageToggle = () => {
  const { locale, setLocale } = useLocaleToggle();
  return (
    <IconButton
      aria-label={locale === "es" ? "Switch to English" : "Cambiar a español"}
      onClick={() => setLocale(locale === "es" ? "en" : "es")}
      className="text-xs font-semibold"
    >
      {locale.toUpperCase()}
    </IconButton>
  );
};

export function TopBar({ onMenuClick }: { onMenuClick: () => void }) {
  const [shrunken, setShrunken] = useState(false);
  const tSidebar = useTranslations("sidebar");

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
      className={
        "no-print sticky top-0 z-40 flex items-center gap-4 border-b border-transparent bg-[var(--plane-translucent)] backdrop-blur transition-all px-4 md:px-6 " +
        (shrunken ? "py-2 shadow-sm" : "py-3")
      }
    >
      <IconButton aria-label={tSidebar("openMenu")} onClick={onMenuClick} className="md:hidden">
        <Menu className="h-4 w-4" />
      </IconButton>
      <div className="min-w-0 flex-1" />
      <div className="flex items-center gap-3">
        <CompanySwitcher />
        <LanguageToggle />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
