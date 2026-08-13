"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { Sun, Moon, Languages, BarChart3, GitBranch, TrendingUp } from "lucide-react";

import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ErrorText } from "@/components/ui/error-text";
import { Eyebrow } from "@/components/ui/eyebrow";
import { IconButton } from "@/components/ui/icon-button";
import { useLocaleToggle } from "@/components/providers/locale-provider";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/api";
import type { Role } from "@/lib/store";

type MyMembershipsResponse = { is_platform_admin: boolean; memberships: { role: Role }[] };

// Sin redirectTo explícito (deep-link a una ruta protegida), el destino por defecto depende del
// rol: un visualizador aterriza en el resumen ejecutivo, el resto en el arranque del pipeline.
async function defaultLandingPath(): Promise<string> {
  try {
    const { memberships } = await apiFetch<MyMembershipsResponse>("/me/memberships", { skipCompanyHeader: true });
    if (memberships[0]?.role === "visualizador") return "/executive-summary";
  } catch {
    // Sin memberships resolubles (p. ej. platform_admin sin compañía todavía) — cae al default.
  }
  return "/datasets";
}

// Errores de Supabase Auth llegan en inglés desde el SDK, sin código — se mapean por el texto
// conocido de los casos más comunes; lo que no reconozca cae al mensaje crudo del SDK.
function translateAuthError(message: string, t: ReturnType<typeof useTranslations>): string {
  const known: Record<string, string> = {
    "Invalid login credentials": t("errors.invalidCredentials"),
    "Email not confirmed": t("errors.emailNotConfirmed"),
    "Too many requests": t("errors.tooManyRequests"),
  };
  return known[message] || message;
}

function HeaderToggles() {
  const { resolvedTheme, setTheme } = useTheme();
  const { locale, setLocale } = useLocaleToggle();
  const isDark = resolvedTheme === "dark";
  return (
    <div className="absolute right-4 top-4 flex items-center gap-2 sm:right-6 sm:top-6">
      <IconButton
        aria-label={locale === "es" ? "Switch to English" : "Cambiar a español"}
        onClick={() => setLocale(locale === "es" ? "en" : "es")}
      >
        <Languages className="h-4 w-4" />
      </IconButton>
      <IconButton aria-label="Toggle theme" onClick={() => setTheme(isDark ? "light" : "dark")}>
        {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </IconButton>
    </div>
  );
}

function BrandPanel() {
  const t = useTranslations("login");
  const features = [
    { icon: GitBranch, text: t("features.pipeline") },
    { icon: BarChart3, text: t("features.attribution") },
    { icon: TrendingUp, text: t("features.forecast") },
  ];
  return (
    <div className="hidden flex-col justify-center gap-8 bg-surface-2 px-12 lg:flex lg:w-1/2">
      <div className="max-w-sm space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Aion</p>
        <h1 className="text-3xl font-semibold tracking-tight text-ink">{t("tagline")}</h1>
        <p className="text-sm text-muted">{t("subtagline")}</p>
      </div>
      <ul className="max-w-sm space-y-4">
        {features.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-start gap-3 text-sm text-ink-2">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = getSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (signInError) {
      setError(translateAuthError(signInError.message, t));
      return;
    }
    const redirectTo = searchParams.get("redirectTo") || (await defaultLandingPath());
    router.replace(redirectTo);
    router.refresh();
  }

  return (
    <Card padding="lg" className="w-full max-w-sm">
      <CardHeader as="h2" title="Aion" subtitle={t("subtitle")} />
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-1">
          <Eyebrow htmlFor="login-email">{t("emailLabel")}</Eyebrow>
          <Input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>
        <div className="space-y-1">
          <Eyebrow htmlFor="login-password">{t("passwordLabel")}</Eyebrow>
          <Input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>
        <div aria-live="polite">{error && <ErrorText className="text-sm">{error}</ErrorText>}</div>
        <Button type="submit" size="lg" disabled={loading} className="w-full">
          {loading ? t("submitting") : t("submit")}
        </Button>
      </form>
      <div className="mt-4 text-center">
        <Link href="/reset-password" className="text-sm text-accent hover:underline">
          {t("forgotPassword")}
        </Link>
      </div>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div className="relative flex min-h-screen">
      <HeaderToggles />
      <BrandPanel />
      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
