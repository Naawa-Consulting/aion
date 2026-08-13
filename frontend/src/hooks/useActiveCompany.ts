"use client";

import { useGlobalStore } from "@/lib/store";

export function useActiveCurrency(): string {
  const activeCompanyId = useGlobalStore((s) => s.activeCompanyId);
  const memberships = useGlobalStore((s) => s.memberships);
  return memberships.find((m) => m.companyId === activeCompanyId)?.currencyCode ?? "MXN";
}
