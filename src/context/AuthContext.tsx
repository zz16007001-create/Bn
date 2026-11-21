import React, {createContext, useCallback, useContext, useEffect, useState} from 'react';
import {runDatabaseMigrations} from '../db/migrations';
import {authRepository} from '../repositories/authRepository';
import {settingsRepository} from '../repositories/settingsRepository';
import type {AuthenticatedSession, CompanySettingsRecord, PermissionKey} from '../types/domain';

const ACTIVE_USER_KEY = 'nukhbat_active_user_id';

interface AuthContextValue {
  isBooting: boolean;
  hasUsers: boolean;
  session: AuthenticatedSession | null;
  companySettings: CompanySettingsRecord | null;
  can: (permission: PermissionKey) => boolean;
  setupInitialAdmin: (input: {
    name: string;
    username: string;
    pin: string;
    companyName?: string;
  }) => Promise<void>;
  loginWithPin: (identifier: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshCompanySettings: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
  const [isBooting, setIsBooting] = useState(true);
  const [hasUsers, setHasUsers] = useState(false);
  const [session, setSession] = useState<AuthenticatedSession | null>(null);
  const [companySettings, setCompanySettings] = useState<CompanySettingsRecord | null>(null);

  const bootstrap = useCallback(async () => {
    try {
      await runDatabaseMigrations();
      const [usersExist, settings] = await Promise.all([
        authRepository.hasAnyUsers(),
        settingsRepository.getCompanySettings(),
      ]);
      setHasUsers(usersExist);
      setCompanySettings(settings);

      const savedUserId = localStorage.getItem(ACTIVE_USER_KEY);
      if (usersExist && savedUserId) {
        const restored = await authRepository.restoreSessionByUserId(savedUserId);
        if (restored) {
          setSession(restored);
        } else {
          localStorage.removeItem(ACTIVE_USER_KEY);
        }
      }
    } finally {
      setIsBooting(false);
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const setupInitialAdmin = useCallback(
    async (input: {name: string; username: string; pin: string; companyName?: string}) => {
      const created = await authRepository.createInitialAdmin(input);
      localStorage.setItem(ACTIVE_USER_KEY, created.user.id);
      const settings = await settingsRepository.getCompanySettings();
      setCompanySettings(settings);
      setHasUsers(true);
      setSession(created);
    },
    []
  );

  const loginWithPin = useCallback(async (identifier: string, pin: string) => {
    const auth = await authRepository.authenticateWithPin(identifier, pin);
    localStorage.setItem(ACTIVE_USER_KEY, auth.user.id);
    setHasUsers(true);
    setSession(auth);
  }, []);

  const logout = useCallback(async () => {
    if (session?.user) {
      try {
        await authRepository.recordLogout(session.user);
      } catch {
        // Ignore audit failure on logout
      }
    }
    localStorage.removeItem(ACTIVE_USER_KEY);
    setSession(null);
  }, [session]);

  const refreshCompanySettings = useCallback(async () => {
    const settings = await settingsRepository.getCompanySettings();
    setCompanySettings(settings);
  }, []);

  const refreshSession = useCallback(async () => {
    if (!session?.user) return;
    const restored = await authRepository.restoreSessionByUserId(session.user.id);
    if (restored) {
      setSession(restored);
    } else {
      localStorage.removeItem(ACTIVE_USER_KEY);
      setSession(null);
    }
  }, [session]);

  const can = useCallback(
    (permission: PermissionKey): boolean => {
      if (!session) return false;
      return session.permissions.has(permission);
    },
    [session]
  );

  return (
    <AuthContext.Provider
      value={{
        isBooting,
        hasUsers,
        session,
        companySettings,
        can,
        setupInitialAdmin,
        loginWithPin,
        logout,
        refreshCompanySettings,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
