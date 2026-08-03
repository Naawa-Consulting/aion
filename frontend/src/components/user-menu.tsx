"use client";

import { useRouter } from "next/navigation";
import { User } from "lucide-react";
import { Dropdown } from "@/components/ui/dropdown";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useGlobalStore } from "@/lib/store";

export function UserMenu() {
  const router = useRouter();
  const userEmail = useGlobalStore((s) => s.userEmail);

  if (!userEmail) return null;

  async function handleSignOut() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    useGlobalStore.getState().setSession(null);
    router.replace("/login");
    router.refresh();
  }

  return (
    <Dropdown
      trigger={
        <span className="p-2 rounded-full border border-[var(--color-border)] hover:bg-[var(--color-accent-soft)] transition-colors">
          <User className="h-4 w-4" />
        </span>
      }
    >
      <div className="px-3 py-2 text-xs text-[var(--color-muted)] truncate">{userEmail}</div>
      <button
        onClick={handleSignOut}
        className="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-[var(--color-accent-soft)]"
      >
        Cerrar sesión
      </button>
    </Dropdown>
  );
}
