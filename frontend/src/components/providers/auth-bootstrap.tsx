"use client";

import React, { useEffect } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/api";
import { useGlobalStore, type Membership } from "@/lib/store";

type MyMembership = { company_id: string; company_name: string; role: Membership["role"] };

async function hydrateMemberships() {
  try {
    const rows = await apiFetch<MyMembership[]>("/me/memberships", { skipCompanyHeader: true });
    useGlobalStore.getState().setMemberships(
      rows.map((r) => ({ companyId: r.company_id, companyName: r.company_name, role: r.role }))
    );
  } catch {
    useGlobalStore.getState().setMemberships([]);
  }
}

export function AuthBootstrap({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    supabase.auth.getSession().then(({ data: { session } }) => {
      const user = session?.user;
      useGlobalStore.getState().setSession(user ? { id: user.id, email: user.email ?? null } : null);
      if (user) hydrateMemberships();
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user;
      useGlobalStore.getState().setSession(user ? { id: user.id, email: user.email ?? null } : null);
      if (user) hydrateMemberships();
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  return <>{children}</>;
}
