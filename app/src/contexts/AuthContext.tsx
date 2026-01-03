import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { initializeGhostIdentity, clearGhostCache, verifyImportedSecret } from '../lib/ghostKeys';
import { Session, User } from '@supabase/supabase-js';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  ghostId: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [ghostId, setGhostId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for existing session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        // Initialize or retrieve ghost identity
        const id = await initializeGhostIdentity(session.user.id);
        setGhostId(id);
      }

      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        // Initialize ghost identity when user signs in
        const id = await initializeGhostIdentity(session.user.id);
        setGhostId(id);
      } else {
        setGhostId(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    if (data.user) {
      // Check if there's an imported ghost secret from QR code
      const importCheck = await verifyImportedSecret(data.user.id);

      if (!importCheck.isValid) {
        console.warn('[AUTH] Import verification failed:', importCheck.error);
      }

      let id: string;
      if (importCheck.ghostId) {
        // Use the imported ghost_id
        id = importCheck.ghostId;
        console.log('[AUTH] User signed in with imported ghost_id:', id);
      } else {
        // No import or new user - initialize normally
        id = await initializeGhostIdentity(data.user.id);
        console.log('[AUTH] User signed in, ghost_id initialized:', id);
      }

      setGhostId(id);
    }
  };

  const signUp = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) throw error;

    if (data.user) {
      // Generate new ghost identity for new user
      const id = await initializeGhostIdentity(data.user.id);
      setGhostId(id);
      console.log('[AUTH] New user registered, ghost_id created:', id);
    }
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;

    // Clear ghost identity cache (but preserve the secret for re-login)
    clearGhostCache();
    setGhostId(null);
    console.log('[AUTH] User signed out, ghost cache cleared (secret preserved)');
  };

  const value = {
    session,
    user,
    ghostId,
    loading,
    signIn,
    signUp,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
