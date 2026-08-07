"use client";

import { useGlobalStore, type Role } from "@/lib/store";

export function useActiveRole(): Role | null {
  const activeCompanyId = useGlobalStore((s) => s.activeCompanyId);
  const memberships = useGlobalStore((s) => s.memberships);
  return memberships.find((m) => m.companyId === activeCompanyId)?.role ?? null;
}

export function useCanEdit(): boolean {
  const role = useActiveRole();
  return role === "modelador" || role === "admin_compania";
}

export function useCanManageUsers(): boolean {
  return useActiveRole() === "admin_compania";
}
