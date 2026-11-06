// Shared by every tab: POSTs to /api/* with the access code, and throws the server's readable error message.

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

export function accessCode(): string {
  try {
    return localStorage.getItem("access-code") ?? "";
  } catch {
    return (document.getElementById("gate-input") as HTMLInputElement | null)?.value ?? "";
  }
}

export async function post<T>(url: string, body: BodyInit, headers: Record<string, string>): Promise<T> {
  const res = await fetch(url, { method: "POST", body, headers: { ...headers, "x-access-code": accessCode() } });
  if (res.status === 401) onUnauthorized();
  const data = await res.json().catch(() => ({ error: `Server returned ${res.status}` }));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Server returned ${res.status}`), { status: res.status });
  return data as T;
}

/** Sends a PDF's raw bytes. */
export const postPdf = <T>(url: string, file: File) =>
  post<T>(url, file, { "content-type": "application/pdf", "x-filename": encodeURIComponent(file.name) });
