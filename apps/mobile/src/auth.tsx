import React, { createContext, useContext, useEffect, useState } from "react";
import type { AuthMode } from "./api";
import { clearAuth, loadAuth } from "./api";

interface AuthContextValue {
  /** null while loading from storage. */
  ready: boolean;
  mode: AuthMode;
  setMode: (mode: AuthMode) => void;
  /** Forget the stored code and go back to the first-open screen. */
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
  }, []);

  const signOut = () => {
    void clearAuth();
    setMode(null);
  };

  return (
    <AuthContext.Provider value={{ ready, mode, setMode, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
