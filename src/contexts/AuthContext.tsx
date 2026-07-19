import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getMfaStatus, verifyTotpCode } from '../lib/authSecurity';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  isDemoUser: boolean;
  isLocalTestUser: boolean;
  /** Cloud session signed in at AAL1 while MFA is enrolled — must verify TOTP. */
  needsMfaVerification: boolean;
  mfaFactorId: string | null;
  signInDemo: () => void;
  signInLocal: (email: string, password: string) => { success: boolean; error?: string };
  signUpLocal: (email: string, password: string) => { success: boolean; error?: string };
  completeMfaChallenge: (code: string) => Promise<{ success: boolean; error?: string }>;
  refreshMfaStatus: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const DEMO_EMAIL = 'demo@travelhandbook.local';
export const DEMO_PASSWORD = 'Demo1234';

const DEMO_STORAGE_KEY = 'travel-handbook-demo-user';
const LOCAL_AUTH_USERS_KEY = 'travel-handbook-local-auth-users';
const LOCAL_AUTH_SESSION_KEY = 'travel-handbook-local-auth-session';

interface LocalAuthUser {
  email: string;
  password: string;
}

const createDemoUser = (): User =>
  ({
    id: 'demo-user',
    email: DEMO_EMAIL,
    aud: 'authenticated',
    role: 'authenticated',
    created_at: new Date().toISOString(),
    app_metadata: {},
    user_metadata: { demo: true },
  }) as User;

const createLocalTestUser = (email: string): User =>
  ({
    id: `local-${email.toLowerCase()}`,
    email,
    aud: 'authenticated',
    role: 'authenticated',
    created_at: new Date().toISOString(),
    app_metadata: {},
    user_metadata: { localTest: true },
  }) as User;

const readLocalAuthUsers = (): LocalAuthUser[] => {
  const raw = localStorage.getItem(LOCAL_AUTH_USERS_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as LocalAuthUser[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => typeof item?.email === 'string' && typeof item?.password === 'string');
  } catch {
    return [];
  }
};

const writeLocalAuthUsers = (users: LocalAuthUser[]) => {
  localStorage.setItem(LOCAL_AUTH_USERS_KEY, JSON.stringify(users));
};

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  isLoading: true,
  isDemoUser: false,
  isLocalTestUser: false,
  needsMfaVerification: false,
  mfaFactorId: null,
  signInDemo: () => {},
  signInLocal: () => ({ success: false }),
  signUpLocal: () => ({ success: false }),
  completeMfaChallenge: async () => ({ success: false }),
  refreshMfaStatus: async () => {},
  signOut: async () => {},
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDemoUser, setIsDemoUser] = useState(false);
  const [isLocalTestUser, setIsLocalTestUser] = useState(false);
  const [needsMfaVerification, setNeedsMfaVerification] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);

  const applyMfaStatus = useCallback(async (activeSession: Session | null) => {
    if (!activeSession || !isSupabaseConfigured()) {
      setNeedsMfaVerification(false);
      setMfaFactorId(null);
      return;
    }

    try {
      const status = await getMfaStatus();
      setNeedsMfaVerification(status.needsChallenge);
      setMfaFactorId(status.verifiedFactors[0]?.id ?? null);
    } catch {
      // If MFA status cannot be read, do not block the session indefinitely.
      setNeedsMfaVerification(false);
      setMfaFactorId(null);
    }
  }, []);

  const refreshMfaStatus = useCallback(async () => {
    await applyMfaStatus(session);
  }, [applyMfaStatus, session]);

  useEffect(() => {
    const hasDemoSession = localStorage.getItem(DEMO_STORAGE_KEY) === 'true';
    if (hasDemoSession) {
      setSession(null);
      setUser(createDemoUser());
      setIsDemoUser(true);
      setIsLocalTestUser(false);
      setNeedsMfaVerification(false);
      setMfaFactorId(null);
      setIsLoading(false);
      return;
    }

    const localSessionEmail = localStorage.getItem(LOCAL_AUTH_SESSION_KEY);
    if (localSessionEmail) {
      setSession(null);
      setUser(createLocalTestUser(localSessionEmail));
      setIsDemoUser(false);
      setIsLocalTestUser(true);
      setNeedsMfaVerification(false);
      setMfaFactorId(null);
      setIsLoading(false);
      return;
    }

    if (!isSupabaseConfigured()) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    supabase.auth.getSession().then(async ({ data: { session: nextSession } }) => {
      if (cancelled) return;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setIsDemoUser(false);
      setIsLocalTestUser(false);
      await applyMfaStatus(nextSession);
      if (!cancelled) setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setIsDemoUser(false);
      setIsLocalTestUser(false);
      void applyMfaStatus(nextSession);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [applyMfaStatus]);

  const signInDemo = () => {
    localStorage.setItem(DEMO_STORAGE_KEY, 'true');
    localStorage.removeItem(LOCAL_AUTH_SESSION_KEY);
    setSession(null);
    setUser(createDemoUser());
    setIsDemoUser(true);
    setIsLocalTestUser(false);
    setNeedsMfaVerification(false);
    setMfaFactorId(null);
    setIsLoading(false);
  };

  const signInLocal = (email: string, password: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    const matchedUser = readLocalAuthUsers().find(
      (item) => item.email.toLowerCase() === normalizedEmail && item.password === password
    );

    if (!matchedUser) {
      return { success: false, error: 'Incorrect email or password.' };
    }

    localStorage.removeItem(DEMO_STORAGE_KEY);
    localStorage.setItem(LOCAL_AUTH_SESSION_KEY, matchedUser.email);
    setSession(null);
    setUser(createLocalTestUser(matchedUser.email));
    setIsDemoUser(false);
    setIsLocalTestUser(true);
    setNeedsMfaVerification(false);
    setMfaFactorId(null);
    setIsLoading(false);
    return { success: true };
  };

  const signUpLocal = (email: string, password: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    const users = readLocalAuthUsers();

    if (users.some((item) => item.email.toLowerCase() === normalizedEmail)) {
      return { success: false, error: 'A local test account with this email already exists. Try signing in instead.' };
    }

    const nextUsers = [...users, { email: normalizedEmail, password }];
    writeLocalAuthUsers(nextUsers);
    localStorage.removeItem(DEMO_STORAGE_KEY);
    localStorage.setItem(LOCAL_AUTH_SESSION_KEY, normalizedEmail);
    setSession(null);
    setUser(createLocalTestUser(normalizedEmail));
    setIsDemoUser(false);
    setIsLocalTestUser(true);
    setNeedsMfaVerification(false);
    setMfaFactorId(null);
    setIsLoading(false);
    return { success: true };
  };

  const completeMfaChallenge = async (code: string) => {
    if (!mfaFactorId) {
      return { success: false, error: 'No authenticator is enrolled on this account.' };
    }

    try {
      await verifyTotpCode(mfaFactorId, code);
      setNeedsMfaVerification(false);
      await applyMfaStatus((await supabase.auth.getSession()).data.session);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Invalid authenticator code.',
      };
    }
  };

  const signOut = async () => {
    localStorage.removeItem(DEMO_STORAGE_KEY);
    localStorage.removeItem(LOCAL_AUTH_SESSION_KEY);
    setSession(null);
    setUser(null);
    setIsDemoUser(false);
    setIsLocalTestUser(false);
    setNeedsMfaVerification(false);
    setMfaFactorId(null);
    if (isSupabaseConfigured()) {
      await supabase.auth.signOut();
    }
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        isLoading,
        isDemoUser,
        isLocalTestUser,
        needsMfaVerification,
        mfaFactorId,
        signInDemo,
        signInLocal,
        signUpLocal,
        completeMfaChallenge,
        refreshMfaStatus,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
