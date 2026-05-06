import { createContext, useContext, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  isDemoUser: boolean;
  isLocalTestUser: boolean;
  signInDemo: () => void;
  signInLocal: (email: string, password: string) => { success: boolean; error?: string };
  signUpLocal: (email: string, password: string) => { success: boolean; error?: string };
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
  signInDemo: () => {},
  signInLocal: () => ({ success: false }),
  signUpLocal: () => ({ success: false }),
  signOut: async () => {},
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDemoUser, setIsDemoUser] = useState(false);
  const [isLocalTestUser, setIsLocalTestUser] = useState(false);

  useEffect(() => {
    const hasDemoSession = localStorage.getItem(DEMO_STORAGE_KEY) === 'true';
    if (hasDemoSession) {
      setSession(null);
      setUser(createDemoUser());
      setIsDemoUser(true);
      setIsLocalTestUser(false);
      setIsLoading(false);
      return;
    }

    const localSessionEmail = localStorage.getItem(LOCAL_AUTH_SESSION_KEY);
    if (localSessionEmail) {
      setSession(null);
      setUser(createLocalTestUser(localSessionEmail));
      setIsDemoUser(false);
      setIsLocalTestUser(true);
      setIsLoading(false);
      return;
    }

    if (!isSupabaseConfigured()) {
      setIsLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsDemoUser(false);
      setIsLocalTestUser(false);
      setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsDemoUser(false);
      setIsLocalTestUser(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInDemo = () => {
    localStorage.setItem(DEMO_STORAGE_KEY, 'true');
    localStorage.removeItem(LOCAL_AUTH_SESSION_KEY);
    setSession(null);
    setUser(createDemoUser());
    setIsDemoUser(true);
    setIsLocalTestUser(false);
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
    setIsLoading(false);
    return { success: true };
  };

  const signOut = async () => {
    localStorage.removeItem(DEMO_STORAGE_KEY);
    localStorage.removeItem(LOCAL_AUTH_SESSION_KEY);
    setSession(null);
    setUser(null);
    setIsDemoUser(false);
    setIsLocalTestUser(false);
    if (isSupabaseConfigured()) {
      await supabase.auth.signOut();
    }
  };

  return (
    <AuthContext.Provider value={{ session, user, isLoading, isDemoUser, isLocalTestUser, signInDemo, signInLocal, signUpLocal, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
