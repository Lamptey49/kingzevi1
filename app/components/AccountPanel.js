'use client';

import Link from 'next/link';
import { useAuth } from '../context/AuthContext';

export default function AccountPanel() {
  const { user, logout, loading } = useAuth();

  if (loading) {
    return <p className="message-box">Loading your account…</p>;
  }

  if (!user) {
    return (
      <section className="card auth-card">
        <h2>You are not signed in</h2>
        <p>Visit the auth screen to create an account or log in.</p>
        <Link href="/auth" className="primary-btn">Go to auth</Link>
      </section>
    );
  }

  return (
    <section className="card auth-card">
      <p className="eyebrow">Account</p>
      <h2>{user.username}</h2>
      <p>{user.email}</p>
      <p><strong>Role:</strong> {user.role}</p>
      <button className="primary-btn" onClick={logout}>Sign out</button>
    </section>
  );
}
