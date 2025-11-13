type Locale = "en" | "es";

const dictionary: Record<Locale, Record<string, string>> = {
  en: {
    datasets: "Datasets",
  },
  es: {
    datasets: "Conjuntos",
  },
};

export function t(key: string, locale: Locale = "en") {
  return dictionary[locale]?.[key] ?? key;
}

