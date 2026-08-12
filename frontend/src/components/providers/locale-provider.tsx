"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import es from "@/lib/i18n/messages/es.json";
import en from "@/lib/i18n/messages/en.json";

export type Locale = "es" | "en";

const MESSAGES: Record<Locale, typeof es> = { es, en };

const STORAGE_KEY = "aion-locale";

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

// Mismo patrón que theme-provider.tsx / next-themes, pero sin librería: la preferencia vive en
// localStorage (no en BD, no hay prefijo de ruta). El primer render siempre es "es" — igual que el
// flash de tema, es un costo aceptado a cambio de no necesitar resolver el locale en el servidor.
export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("es");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "es" || stored === "en") setLocaleState(stored);
  }, []);

  const setLocale = (next: Locale) => {
    setLocaleState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      {/* timeZone fijo: sin él, next-intl cae a la zona del entorno (ENVIRONMENT_FALLBACK) y
          lo reporta como error en cada render estático — no formateamos fechas todavía, pero
          fijarlo evita el ruido y un futuro mismatch servidor/cliente cuando sí se use. */}
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="America/Mexico_City">
        {children}
      </NextIntlClientProvider>
    </LocaleContext.Provider>
  );
}

export function useLocaleToggle() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocaleToggle must be used within LocaleProvider");
  return ctx;
}
