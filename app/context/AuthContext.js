'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { fetchJson } from '../../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = window.localStorage.getItem('kingzevi_token');
    if (!token) {
      setLoading(false);
      return;
    }

    fetchJson('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((data) => setUser(data.user))
      .catch(() => {
        window.localStorage.removeItem('kingzevi_token');
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = (token, userData) => {
    window.localStorage.setItem('kingzevi_token', token);
    setUser(userData);
  };

  const logout = () => {
    window.localStorage.removeItem('kingzevi_token');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
