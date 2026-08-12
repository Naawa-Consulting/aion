"use client";

import React, { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { Menu, Moon, Sun, Languages } from "lucide-react";
import { CompanySwitcher } from "@/components/company-switcher";
import { UserMenu } from "@/components/user-menu";
import { IconButton } from "@/components/ui/icon-button";
import { useLocaleToggle } from "@/components/providers/locale-provider";
import type { PipelineContext } from "@/hooks/usePipelineContext";

const ThemeToggle = () => {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  return (
    <IconButton aria-label="Toggle theme" onClick={() => setTheme(isDark ? "light" : "dark")}>
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </IconButton>
  );
};

const LanguageToggle = () => {
  const { locale, setLocale } = useLocaleToggle();
  return (
    <IconButton
      aria-label={locale === "es" ? "Switch to English" : "Cambiar a español"}
      onClick={() => setLocale(locale === "es" ? "en" : "es")}
    >
      <Languages className="h-4 w-4" />
    </IconButton>
  );
};

// Barra de contexto persistente: hoy Datasets/Transform/Modeling/Analysis reimplementan el
// selector de dataset/modelo activos en 3 posiciones distintas. `usePipelineContext` ya resuelve
// el nombre a partir de los ids que `lib/store.ts` persiste — esto solo lo expone.
function ContextBar({ pipelineContext }: { pipelineContext: PipelineContext }) {
  const t = useTranslations("context");
  const { datasetName, modelName } = pipelineContext;

  if (!datasetName) return null;

  return (
    <div className="hidden min-w-0 items-center gap-4 text-sm sm:flex">
      <span className="min-w-0 truncate">
        <span className="text-muted">{t("dataset")}: </span>
        <span className="text-ink">{datasetName}</span>
      </span>
      {modelName && (
        <span className="min-w-0 truncate">
          <span className="text-muted">{t("model")}: </span>
          <span className="text-ink">{modelName}</span>
        </span>
      )}
    </div>
  );
}

export function TopBar({
  onMenuClick,
  pipelineContext,
}: {
  onMenuClick: () => void;
  pipelineContext: PipelineContext;
}) {
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
      <div className="flex min-w-0 flex-1 items-center">
        <ContextBar pipelineContext={pipelineContext} />
      </div>
      <div className="flex items-center gap-3">
        <CompanySwitcher />
        <LanguageToggle />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
