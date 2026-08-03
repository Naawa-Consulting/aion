"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    supabase.auth.getSession().then(({ data: { session } }) => setHasSession(!!session));
  }, []);

  async function requestLink(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    const supabase = getSupabaseBrowserClient();
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    setMessage("Si el correo existe, te enviamos un enlace para restablecer tu contraseña.");
  }

  async function setNewPassword(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = getSupabaseBrowserClient();
    const { error: err } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (err) {
      setError(err.message);
      return;
    }
    router.replace("/datasets");
    router.refresh();
  }

  if (hasSession === null) return null;

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <Card padding="lg">
          {hasSession ? (
            <>
              <CardHeader title="Nueva contraseña" subtitle="Elige una nueva contraseña para tu cuenta" />
              <form onSubmit={setNewPassword} className="space-y-4">
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Nueva contraseña"
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
                {error && <p className="text-sm text-red-500">{error}</p>}
                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? "Guardando..." : "Guardar contraseña"}
                </Button>
              </form>
            </>
          ) : (
            <>
              <CardHeader title="Restablecer contraseña" subtitle="Te enviaremos un enlace por correo" />
              <form onSubmit={requestLink} className="space-y-4">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Correo"
                  required
                  autoComplete="email"
                />
                {error && <p className="text-sm text-red-500">{error}</p>}
                {message && <p className="text-sm text-[var(--color-accent)]">{message}</p>}
                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? "Enviando..." : "Enviar enlace"}
                </Button>
              </form>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
