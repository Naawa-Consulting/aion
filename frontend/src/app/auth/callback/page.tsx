"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// Supabase's default email templates (invite, recovery, magic link) send the user to
// Supabase's own hosted /auth/v1/verify endpoint, which then redirects back here with the
// session delivered as a URL *hash fragment* (#access_token=...&refresh_token=...) — that
// fragment never reaches a server, so this has to be a client page, not a route handler.
// We also handle token_hash/type (custom email templates) and code (PKCE) as fallbacks.
function AuthCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function run() {
      const supabase = getSupabaseBrowserClient();
      const next = searchParams.get("next") || "/reset-password";

      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (!sessionError) {
          router.replace(next);
          return;
        }
      }

      const tokenHash = searchParams.get("token_hash");
      const type = searchParams.get("type");
      if (tokenHash && type) {
        const { error: otpError } = await supabase.auth.verifyOtp({
          type: type as any,
          token_hash: tokenHash,
        });
        if (!otpError) {
          router.replace(next);
          return;
        }
      }

      const code = searchParams.get("code");
      if (code) {
        const { error: codeError } = await supabase.auth.exchangeCodeForSession(code);
        if (!codeError) {
          router.replace(next);
          return;
        }
      }

      // Last resort: a session may already exist (e.g. Supabase's client auto-detected the
      // fragment before this effect ran).
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        router.replace(next);
        return;
      }

      setError("El enlace es inválido o ya expiró. Pide que te envíen una invitación nueva.");
    }
    run();
  }, [router, searchParams]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }
  return null;
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <AuthCallback />
    </Suspense>
  );
}
