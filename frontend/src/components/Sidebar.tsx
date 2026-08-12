"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { ChevronsLeft, ChevronsRight, LayoutDashboard, ShieldCheck, X } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip } from "@/components/ui/tooltip";
import { useCanManageUsers, useIsPlatformAdmin } from "@/hooks/useCanEdit";
import type { PipelineContext } from "@/hooks/usePipelineContext";

const PIPELINE = [
  { href: "/datasets", key: "datasets" as const, step: 1 },
  { href: "/transform", key: "transform" as const, step: 2 },
  { href: "/modeling", key: "modeling" as const, step: 3 },
  { href: "/analysis", key: "analysis" as const, step: 4 },
  { href: "/predict", key: "predict" as const, step: 5 },
];

const EXECUTIVE_LINK = { href: "/executive-summary", key: "executiveSummary" as const, Icon: LayoutDashboard };
const ADMIN_LINK = { href: "/admin", key: "admin" as const, Icon: ShieldCheck };

const COLLAPSE_KEY = "aion-sidebar-collapsed";

function incompleteSteps(ctx: PipelineContext): Partial<Record<string, boolean>> {
  if (!ctx.hasDataset) return {};
  return { datasets: !ctx.hasTimeVariable, modeling: !ctx.hasHeroModel };
}

type LinkItemProps = {
  href: string;
  label: string;
  scope: "desktop" | "mobile";
  collapsed?: boolean;
  onNavigate?: () => void;
  step?: number;
  Icon?: React.ComponentType<{ className?: string }>;
  incomplete?: boolean;
  incompleteLabel?: string;
};

function LinkItem({ href, label, scope, collapsed, onNavigate, step, Icon, incomplete, incompleteLabel }: LinkItemProps) {
  const pathname = usePathname();
  const shouldReduceMotion = useReducedMotion();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  const content = (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2",
        collapsed && "justify-center px-0",
        active ? "text-accent" : "text-muted hover:text-ink hover:bg-surface-2"
      )}
    >
      {active && (
        <motion.span
          layoutId={`sidebar-active-pill-${scope}`}
          className="absolute inset-0 rounded-lg bg-accent-bg"
          transition={shouldReduceMotion ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 35 }}
        />
      )}
      <span
        className={clsx(
          "relative z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current text-[10px] font-medium",
          !step && "border-none"
        )}
      >
        {step ?? (Icon && <Icon className="h-4 w-4" />)}
      </span>
      {!collapsed && <span className="relative z-10 flex-1 truncate">{label}</span>}
      {incomplete && (
        <span
          className={clsx("relative z-10 h-1.5 w-1.5 shrink-0 rounded-full bg-warn", collapsed && "absolute right-1 top-1")}
          aria-hidden
        />
      )}
    </Link>
  );

  if (!collapsed) return content;
  return (
    <Tooltip content={incomplete && incompleteLabel ? `${label} — ${incompleteLabel}` : label} className="whitespace-normal">
      {content}
    </Tooltip>
  );
}

function SidebarNav({
  scope,
  collapsed,
  onNavigate,
  pipelineContext,
}: {
  scope: "desktop" | "mobile";
  collapsed?: boolean;
  onNavigate?: () => void;
  pipelineContext: PipelineContext;
}) {
  const t = useTranslations("nav");
  const tSidebar = useTranslations("sidebar");
  const isPlatformAdmin = useIsPlatformAdmin();
  const canManageUsers = useCanManageUsers();
  const incomplete = incompleteSteps(pipelineContext);

  return (
    <nav className="flex flex-1 flex-col gap-1 px-2">
      {PIPELINE.map((item) => (
        <LinkItem
          key={item.href}
          href={item.href}
          label={t(item.key)}
          scope={scope}
          collapsed={collapsed}
          onNavigate={onNavigate}
          step={item.step}
          incomplete={incomplete[item.key]}
          incompleteLabel={incomplete[item.key] ? tSidebar(item.key === "datasets" ? "incompleteDatasets" : "incompleteModeling") : undefined}
        />
      ))}
      <div className="my-2 border-t border-line" />
      <LinkItem
        href={EXECUTIVE_LINK.href}
        label={t(EXECUTIVE_LINK.key)}
        scope={scope}
        collapsed={collapsed}
        onNavigate={onNavigate}
        Icon={EXECUTIVE_LINK.Icon}
      />
      {(isPlatformAdmin || canManageUsers) && (
        <LinkItem
          href={ADMIN_LINK.href}
          label={t(ADMIN_LINK.key)}
          scope={scope}
          collapsed={collapsed}
          onNavigate={onNavigate}
          Icon={ADMIN_LINK.Icon}
        />
      )}
    </nav>
  );
}

type SidebarProps = {
  mobileOpen: boolean;
  onMobileClose: () => void;
  pipelineContext: PipelineContext;
};

export function Sidebar({ mobileOpen, onMobileClose, pipelineContext }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const tSidebar = useTranslations("sidebar");

  useEffect(() => {
    const stored = window.localStorage.getItem(COLLAPSE_KEY);
    if (stored === "1") setCollapsed(true);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onMobileClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen, onMobileClose]);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  }

  return (
    <>
      {/* Desktop: columna persistente, colapsable. Oculta (display:none) bajo md — sigue montada
          para que el layoutId de su pill no colisione con el del drawer móvil (ver scope). */}
      <aside
        className={clsx(
          "no-print sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line bg-surface py-4 transition-[width] md:flex",
          collapsed ? "w-16" : "w-56"
        )}
      >
        <div className={clsx("mb-4 flex items-center px-3", collapsed ? "justify-center" : "justify-between")}>
          {!collapsed && (
            <Link href="/datasets" className="text-lg font-semibold tracking-tight text-ink">
              Aion
            </Link>
          )}
          <IconButton
            size="sm"
            aria-label={collapsed ? tSidebar("expand") : tSidebar("collapse")}
            onClick={toggleCollapsed}
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </IconButton>
        </div>
        <SidebarNav scope="desktop" collapsed={collapsed} pipelineContext={pipelineContext} />
      </aside>

      {/* Móvil: drawer con overlay, mismo patrón de Modal (backdrop + Escape). Solo se monta
          mientras está abierto, así que no compite por el layoutId con el sidebar de escritorio. */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            className="no-print fixed inset-0 z-50 flex md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <motion.div
              className="absolute inset-0 bg-black/40"
              onClick={onMobileClose}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <motion.aside
              className="relative flex h-full w-64 flex-col bg-surface py-4 shadow-[var(--shadow-soft)]"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "tween", duration: 0.2, ease: "easeOut" }}
            >
              <div className="mb-4 flex items-center justify-between px-3">
                <span className="text-lg font-semibold tracking-tight text-ink">Aion</span>
                <IconButton size="sm" aria-label={tSidebar("closeMenu")} onClick={onMobileClose}>
                  <X className="h-4 w-4" />
                </IconButton>
              </div>
              <SidebarNav scope="mobile" onNavigate={onMobileClose} pipelineContext={pipelineContext} />
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
