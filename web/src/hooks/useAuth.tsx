import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { apiFetch, getToken, setToken, clearToken } from '../lib/api';
import type { User } from '../lib/types';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp < Math.floor(Date.now() / 1000);
  } catch {
    return true;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // Check for access token in URL hash (after OAuth redirect)
        const hash = window.location.hash;
        if (hash.includes('access_token')) {
          const params = new URLSearchParams(hash.substring(1));
          const accessToken = params.get('access_token');
          if (accessToken) {
            setToken(accessToken);
            // Clean up URL
            window.history.replaceState(null, '', window.location.pathname);
          }
        }

        // Check if we have a valid token in localStorage
        const token = getToken();
        if (!token || isTokenExpired(token)) {
          clearToken();
          return;
        }

        // Fetch user profile from Edge Function
        const profile = await apiFetch<User>('get-me');
        if (!cancelled) setUser(profile);
      } catch {
        clearToken();
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(() => {
    const clientId = import.meta.env.VITE_SLACK_CLIENT_ID;
    const insforgeUrl = import.meta.env.VITE_INSFORGE_URL;
    const redirectUri = `${insforgeUrl}/functions/slack-oauth-callback`;
    const scopes = 'channels:read,channels:history,users:read,reactions:read,team:read';

    window.location.href =
      `https://slack.com/oauth/v2/authorize?client_id=${clientId}` +
      `&scope=${scopes}` +
      `&user_scope=channels:read,channels:history` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}`;
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
