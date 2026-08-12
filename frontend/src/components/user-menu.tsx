"use client";

import { useRouter } from "next/navigation";
import { User } from "lucide-react";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
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
        // No es <IconButton> porque Dropdown ya envuelve el trigger en su propio <button> —
        // anidar botones es inválido. Mismas clases que IconButton, como <span>.
        <span className="inline-flex h-control-md w-control-md items-center justify-center rounded-full border border-border-control hover:bg-accent-bg transition duration-150">
          <User className="h-4 w-4" />
        </span>
      }
    >
      <div className="px-3 py-2 text-xs text-muted truncate">{userEmail}</div>
      <DropdownItem onClick={handleSignOut}>Cerrar sesión</DropdownItem>
    </Dropdown>
  );
}
