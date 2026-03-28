const TOKEN_KEY = 'flowstate_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export async function apiFetch<T = unknown>(
  functionName: string,
  body?: unknown,
): Promise<T> {
  const token = getToken();
  const res = await fetch(
    `${import.meta.env.VITE_INSFORGE_URL}/functions/${functionName}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );

  if (res.status === 401) {
    clearToken();
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    throw new Error(await res.text());
  }

  return res.json();
}
