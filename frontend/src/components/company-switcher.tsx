"use client";

import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
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
        <span className="text-muted">{active.companyName}</span>
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
        <DropdownItem
          key={m.companyId}
          active={m.companyId === activeCompanyId}
          onClick={() => {
            setActiveCompanyId(m.companyId);
            router.push("/datasets");
          }}
        >
          {m.companyName}
          <Badge variant={roleBadgeVariant(m.role)}>{roleLabel(m.role)}</Badge>
        </DropdownItem>
      ))}
    </Dropdown>
  );
}
