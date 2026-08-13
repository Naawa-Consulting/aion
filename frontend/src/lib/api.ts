import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useGlobalStore } from "@/lib/store";

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export class ApiError extends Error {
  status: number;
  detail: any;
  code?: string;
  constructor(status: number, detail: any, message?: string, code?: string) {
    super(message || `Request failed with status ${status}`);
    this.status = status;
    this.detail = detail;
    this.code = code;
  }
}

function safeParseJSON(raw: string): any {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function extractCode(detail: any): string | undefined {
  return detail && typeof detail.code === "string" ? detail.code : undefined;
}

function extractMessage(detail: any): string | undefined {
  if (!detail) return undefined;
  if (typeof detail === "string") return detail;
  if (typeof detail.message === "string") return detail.message;
  if (typeof detail.detail === "string") return detail.detail;
  if (typeof detail.error === "string") return detail.error;
  return undefined;
}

/** Exported so the raw XMLHttpRequest upload in datasets/page.tsx can attach the same headers. */
export async function getAuthHeaders(skipCompany = false): Promise<Record<string, string>> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers: Record<string, string> = {};
  if (session?.access_token) {
    headers["Authorization"] = `Bearer ${session.access_token}`;
  }
  if (!skipCompany) {
    const companyId = useGlobalStore.getState().activeCompanyId;
    if (companyId) headers["X-Company-Id"] = companyId;
  }
  return headers;
}

type ApiFetchOptions = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
  responseType?: "json" | "blob";
  skipCompanyHeader?: boolean;
};

export async function apiFetch<T = unknown>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const authHeaders = await getAuthHeaders(options.skipCompanyHeader);
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { ...authHeaders, ...options.headers },
  });

  if (!res.ok) {
    const raw = await res.text();
    const detail = safeParseJSON(raw);
    throw new ApiError(res.status, detail, extractMessage(detail), extractCode(detail));
  }
  if (options.responseType === "blob") {
    return (await res.blob()) as unknown as T;
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}
