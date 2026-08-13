import { ApiError } from "./api";

type ErrorsTranslator = {
  (key: string, values?: Record<string, any>): string;
  has: (key: string) => boolean;
};

/** Translates a backend `{code, message, ...extra}` error into a localized string via the
 * "errors" i18n namespace, falling back to the raw backend message for codes not (yet) mapped
 * there — see lib/i18n/messages/{es,en}.json. `t` must come from `useTranslations("errors")`. */
export function translateApiError(err: unknown, t: ErrorsTranslator): string {
  if (err instanceof ApiError) {
    if (err.code && t.has(err.code)) {
      const values = err.detail && typeof err.detail === "object" ? err.detail : undefined;
      try {
        return t(err.code, values);
      } catch {
        return t(err.code);
      }
    }
    return err.message || t("unknown");
  }
  if (err instanceof Error) return err.message;
  return t("unknown");
}
