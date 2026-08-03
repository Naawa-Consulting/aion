"use client";

import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import clsx from "clsx";
import { Dropdown } from "@/components/ui/dropdown";
import { Badge } from "@/components/ui/badge";
import { useGlobalStore } from "@/lib/store";
import { roleBadgeVariant, roleLabel } from "@/lib/roles";

export function CompanySwitcher() {
  const router = useRouter();
  const memberships = useGlobalStore((s) => s.memberships);
  const activeCompanyId = useGlobalStore((s) => s.activeCompanyId);
  const setActiveCompanyId = useGlobalStore((s) => s.setActiveCompanyId);
  const active = memberships.find((m) => m.companyId === activeCompanyId);

  if (memberships.length === 0) return null;

  if (memberships.length === 1 && active) {
    return (
      <div className="hidden sm:flex items-center gap-2 text-sm">
        <span className="text-[var(--color-muted)]">{active.companyName}</span>
        <Badge variant={roleBadgeVariant(active.role)}>{roleLabel(active.role)}</Badge>
      </div>
    );
  }

  return (
    <Dropdown
      trigger={
        <span className="flex items-center gap-1 text-sm">
          {active?.companyName ?? "Selecciona compañía"}
          <ChevronDown className="h-3 w-3" />
        </span>
      }
    >
      {memberships.map((m) => (
        <button
          key={m.companyId}
          onClick={() => {
            setActiveCompanyId(m.companyId);
            router.push("/datasets");
          }}
          className={clsx(
            "flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-[var(--color-accent-soft)]",
            m.companyId === activeCompanyId && "bg-[var(--color-accent-soft)]"
          )}
        >
          {m.companyName}
          <Badge variant={roleBadgeVariant(m.role)}>{roleLabel(m.role)}</Badge>
        </button>
      ))}
    </Dropdown>
  );
}
