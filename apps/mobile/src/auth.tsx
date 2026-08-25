import React, { createContext, useContext, useEffect, useState } from "react";
import type { AuthMode } from "./api";
import { clearAuth, currentUserName, loadAuth, setOnUnauthorized } from "./api";

interface AuthContextValue {
  /** null while loading from storage. */
  ready: boolean;
  mode: AuthMode;
  /** Display name of the signed-in person (null in demo). */
  userName: string | null;
  setMode: (mode: AuthMode) => void;
  /** Forget the stored session and go back to the sign-in screen. */
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<AuthMode>(null);

  useEffect(() => {
    loadAuth().then((m) => {
      setMode(m);
      setReady(true);
    });
    // The server rejected our session (monthly expiry) — show the gate again.
    setOnUnauthorized(() => setMode(null));
    return () => setOnUnauthorized(null);
  }, []);

  const signOut = () => {
    void clearAuth();
    setMode(null);
  };

  return (
    <AuthContext.Provider value={{ ready, mode, userName: currentUserName(), setMode, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
