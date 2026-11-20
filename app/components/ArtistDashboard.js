'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchJson } from '../../lib/api';
import ArtistMusicForm from './ArtistMusicForm';
import ArtistReleasesList from './ArtistReleasesList';

export default function ArtistDashboard() {
  const { user, loading } = useAuth();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user || user.role !== 'artist') return;

    const token = window.localStorage.getItem('kingzevi_token');
    if (!token) return;

    fetchJson('/api/music/stats/artist', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((data) => setStats(data))
      .catch(() => setError('Unable to load artist stats.'));
  }, [user]);

  if (loading) {
    return <p className="message-box">Loading your artist dashboard…</p>;
  }

  if (!user) {
    return (
      <section className="card auth-card">
        <h2>Access denied</h2>
        <p>You need to sign in before viewing the artist dashboard.</p>
        <Link href="/auth" className="primary-btn">Go to auth</Link>
      </section>
    );
  }

  if (user.role !== 'artist') {
    return (
      <section className="card auth-card">
        <h2>Artist access required</h2>
        <p>This dashboard is only available to artists.</p>
        <Link href="/account" className="secondary-btn">Go to account</Link>
      </section>
    );
  }

  return (
    <section className="card auth-card">
      <p className="eyebrow">Artist Dashboard</p>
      <h2>Welcome, {user.username}</h2>
      <p>Your music performance and audience overview.</p>
      {error ? <p className="message-box">{error}</p> : null}
      {stats ? (
        <div className="grid stats-grid">
          <article className="card">
            <h2>{stats.tracks ?? 0}</h2>
            <p>Tracks</p>
          </article>
          <article className="card">
            <h2>{stats.albums ?? 0}</h2>
            <p>Albums</p>
          </article>
          <article className="card">
            <h2>{stats.streams ?? 0}</h2>
            <p>Streams</p>
          </article>
          <article className="card">
            <h2>{stats.downloads ?? 0}</h2>
            <p>Downloads</p>
          </article>
        </div>
      ) : (
        <p className="message-box">Loading stats…</p>
      )}

      <ArtistMusicForm />
      <ArtistReleasesList />
    </section>
  );
}
