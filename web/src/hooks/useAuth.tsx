import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { insforge } from '../insforge';
import type { User } from '../lib/types';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

async function fetchUserProfile(userId: string): Promise<User | null> {
  const { data } = await insforge.database
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();
  return data as User | null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // Check for access token in URL hash (after OAuth redirect from our Edge Function)
        const hash = window.location.hash;
        if (hash.includes('access_token')) {
          const params = new URLSearchParams(hash.substring(1));
          const accessToken = params.get('access_token');

          if (accessToken) {
            // Set the token on the HTTP client for authenticated requests
            insforge.getHttpClient().setAuthToken(accessToken);

            // Clean up URL
            window.history.replaceState(null, '', window.location.pathname);
          }
        }

        // Check if we have an authenticated user
        const { data, error } = await insforge.auth.getCurrentUser();

        if (!error && data?.user && !cancelled) {
          const profile = await fetchUserProfile(data.user.id);
          if (!cancelled) setUser(profile);
        }
      } catch {
        // No valid session
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

  const logout = useCallback(async () => {
    await insforge.auth.signOut();
    insforge.getHttpClient().setAuthToken(null);
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
