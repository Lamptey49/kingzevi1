'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchJson } from '../../lib/api';
import { useAuth } from '../context/AuthContext';

const emptyForm = {
  username: '',
  email: '',
  password: '',
  role: 'fan',
  avatar: '',
};

export default function AuthPanel() {
  const router = useRouter();
  const { user, login, logout, loading: authLoading } = useAuth();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setMessage('');
    setLoading(true);

    try {
      const payload = mode === 'login'
        ? { email: form.email, password: form.password }
        : {
            username: form.username,
            email: form.email,
            password: form.password,
            role: form.role,
            avatar: form.avatar || undefined,
          };

      const response = await fetchJson(mode === 'login' ? '/api/auth/login' : '/api/auth/register', {
        method: 'POST',
        body: payload,
      });

      login(response.token, response.user);
      setMessage(mode === 'login' ? 'Welcome back!' : 'Account created successfully.');
      setForm(emptyForm);
      router.push('/account');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    setMessage('You have been signed out.');
  };

  if (authLoading) {
    return <p className="message-box">Loading your session…</p>;
  }

  return (
    <section className="auth-shell">
      <div className="hero-card compact">
        <p className="eyebrow">Register/Sign In</p>
        <h1>{user ? 'Welcome back' : mode === 'login' ? 'Sign in to your account' : 'Create your account'}</h1>
        <p className="hero-copy">
          {user
            ? `Signed in as ${user.username}.` 
            : 'Use the forms below to log in or register.'}
        </p>
      </div>

      {message ? <p className="message-box">{message}</p> : null}

      {user ? (
        <div className="card auth-card">
          <h2>{user.username}</h2>
          <p>{user.email}</p>
          <p className="eyebrow">{user.role}</p>
          <button className="primary-btn" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      ) : (
        <form className="card auth-card" onSubmit={handleSubmit}>
          {mode === 'register' ? (
            <>
              <label>
                Username
                <input name="username" value={form.username} onChange={handleChange} required />
              </label>
            </>
          ) : null}

          <label>
            Email
            <input type="email" name="email" value={form.email} onChange={handleChange} required />
          </label>

          <label>
            Password
            <input type="password" name="password" value={form.password} onChange={handleChange} required />
          </label>

          {mode === 'register' ? (
            <>
              <label>
                Role
                <select name="role" value={form.role} onChange={handleChange}>
                  <option value="fan">Fan</option>
                  <option value="artist">Artist</option>
                </select>
              </label>

              <label>
                Avatar (optional)
                <input name="avatar" value={form.avatar} onChange={handleChange} placeholder="🎧" />
              </label>
            </>
          ) : null}

          <button className="primary-btn" type="submit" disabled={loading}>
            {loading ? 'Loading...' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>

          <button type="button" className="secondary-btn switch-btn" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? 'Need an account? Register' : 'Already have an account? Log in'}
          </button>
        </form>
      )}
    </section>
  );
}
