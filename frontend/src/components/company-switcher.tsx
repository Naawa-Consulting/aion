"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useGlobalStore } from "@/lib/store";
import { roleBadgeVariant, roleLabel } from "@/lib/roles";

export function CompanySwitcher() {
  const t = useTranslations("common");
  const router = useRouter();
  const memberships = useGlobalStore((s) => s.memberships);
  const activeCompanyId = useGlobalStore((s) => s.activeCompanyId);
  const setActiveCompanyId = useGlobalStore((s) => s.setActiveCompanyId);
  const unsavedChangesActive = useGlobalStore((s) => s.unsavedChangesActive);
  const [pendingCompanyId, setPendingCompanyId] = useState<string | null>(null);
  const active = memberships.find((m) => m.companyId === activeCompanyId);

  const switchTo = (companyId: string) => {
    setActiveCompanyId(companyId);
    router.push("/datasets");
  };

  const handleSelect = (companyId: string) => {
    // Fase 5/A04-R6: a page can opt into this guard (e.g. Predict with unsaved scenario edits) —
    // everywhere else it's `false` and this is just `switchTo` directly, unchanged.
    if (unsavedChangesActive) {
      setPendingCompanyId(companyId);
      return;
    }
    switchTo(companyId);
  };

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
    <>
      <Dropdown
        trigger={
          <span className="flex items-center gap-1 text-sm">
            {active?.companyName ?? "Selecciona compañía"}
            <ChevronDown className="h-3 w-3" />
          </span>
        }
      >
        {memberships.map((m) => (
          <DropdownItem key={m.companyId} active={m.companyId === activeCompanyId} onClick={() => handleSelect(m.companyId)}>
            {m.companyName}
            <Badge variant={roleBadgeVariant(m.role)}>{roleLabel(m.role)}</Badge>
          </DropdownItem>
        ))}
      </Dropdown>

      <Modal open={pendingCompanyId !== null} onClose={() => setPendingCompanyId(null)} title={t("unsavedChangesTitle")}>
        <p className="text-sm text-ink">{t("unsavedChangesBody")}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setPendingCompanyId(null)}>
            {t("cancel")}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (pendingCompanyId) switchTo(pendingCompanyId);
              setPendingCompanyId(null);
            }}
          >
            {t("unsavedChangesConfirm")}
          </Button>
        </div>
      </Modal>
    </>
  );
}
