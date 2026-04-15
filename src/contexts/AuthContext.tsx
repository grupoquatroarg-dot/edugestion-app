import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { User } from '../types';
import { apiFetch } from '../utils/api';
import { reconnectSocket, disconnectSocket } from '../utils/socket';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  hasPermission: (module: string, action: 'view' | 'create' | 'edit' | 'delete') => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check if user is already logged in
    apiFetch('/api/auth/me')
      .then(res => {
        if (res.ok) return res.json();
        throw new Error('Not logged in');
      })
      .then(data => {
        setUser(data.data);
        reconnectSocket(); // Ensure socket is connected with token if available
      })
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Error al iniciar sesión');
    }

    const loginData = await res.json();
    
    if (loginData.data?.token) {
      localStorage.setItem('auth_token', loginData.data.token);
    }

    // Verify session immediately (will use token if cookie fails)
    const meRes = await apiFetch('/api/auth/me');
    if (!meRes.ok) {
      localStorage.removeItem('auth_token'); // Cleanup if even token fails
      throw new Error('Sesión no persistida. Verifique la configuración de cookies.');
    }

    const userData = await meRes.json();
    setUser(userData.data);
    reconnectSocket(); // Reconnect socket with the new token
  };

  const logout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    localStorage.removeItem('auth_token');
    setUser(null);
    disconnectSocket();
  };

  const hasPermission = (module: string, action: 'view' | 'create' | 'edit' | 'delete') => {
    if (!user) return false;
    if (user.role === 'administrador') return true;
    
    const perm = user.permissions?.[module];
    if (!perm) return false;

    switch (action) {
      case 'view': return !!perm.can_view;
      case 'create': return !!perm.can_create;
      case 'edit': return !!perm.can_edit;
      case 'delete': return !!perm.can_delete;
      default: return false;
    }
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, logout, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
