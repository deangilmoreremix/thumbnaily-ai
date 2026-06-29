const STORAGE_KEY = "thumbnaily.openai_api_key";

export function getStoredApiKey(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function getApiKeyHeaders(): Record<string, string> {
  const key = getStoredApiKey();
  return key ? { "X-OpenAI-Key": key } : {};
}

export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const keyHeaders = getApiKeyHeaders();
  for (const [k, v] of Object.entries(keyHeaders)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  return fetch(url, { ...init, headers });
}