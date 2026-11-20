"use client";

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { fetchJson } from '../lib/api';
import { useAuth } from './context/AuthContext';
import kz_logo from './kz_logo.jpeg';
import Button from './components/Button';

export default function HomePage() {
  const { user, logout } = useAuth();
  const [music, setMusic] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadHomeData() {
      try {
        const [musicRes, statsRes] = await Promise.all([
          fetchJson('/api/music?type=single'),
          fetchJson('/api/social/stats'),
        ]);

        if (!isMounted) return;

        setMusic(musicRes.music ?? []);
        setStats(statsRes ?? {});
      } catch {
        if (isMounted) {
          setMusic([]);
          setStats({});
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadHomeData();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <main className="page-shell">
      <section className="hero-card compact">
        <div className="hero-content">
          <div className="brand-row">
            <Link href="/" className="brand-mark">
              <Image src={kz_logo} alt="King Zevi" width={48} height={48} />
            </Link>
            <div>
              <p className="eyebrow">King Zevi</p>
              <h1>Music, fans, and artist tools in one place.</h1>
            </div>
          </div>

          <p className="hero-copy">
            Share the vibe, discover new releases, and manage your artist space from a single community hub.
          </p>

          <div className="hero-actions">
            <Link href={user ? '/account' : '/auth'}>
              <Button>{user ? 'Open your account' : 'Join the community'}</Button>
            </Link>
            <Link href="/music">
              <Button variant="secondary">Browse music</Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="stats-grid">
        <div className="card stat-card">
          <p className="eyebrow">Community</p>
          <h3>{loading ? '…' : stats.total_posts ?? 0}</h3>
          <p>Posts</p>
        </div>
        <div className="card stat-card">
          <p className="eyebrow">Love</p>
          <h3>{loading ? '…' : stats.total_likes ?? 0}</h3>
          <p>Likes</p>
        </div>
        <div className="card stat-card">
          <p className="eyebrow">Talk</p>
          <h3>{loading ? '…' : stats.total_comments ?? 0}</h3>
          <p>Comments</p>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <div>
            <p className="eyebrow">Latest singles</p>
            <h2>Fresh drops</h2>
          </div>
          <Link href="/music" className="text-link">View all</Link>
        </div>

        {loading ? (
          <p className="hero-copy">Loading music…</p>
        ) : music.length === 0 ? (
          <p className="hero-copy">No singles are available yet.</p>
        ) : (
          <div className="music-list">
            {music.map((item) => (
              <article key={item.id} className="music-card">
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.description || 'New release from the King Zevi community.'}</p>
                </div>
                <Link href={`/music/${item.id}`} className="text-link">Open</Link>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="section-head">
          <div>
            <p className="eyebrow">Quick access</p>
            <h2>Go where you need</h2>
          </div>
        </div>

        <div className="quick-links">
          <Link href="/auth" className="quick-link">Sign in or register</Link>
          <Link href="/account" className="quick-link">Account</Link>
          {user?.role === 'artist' ? <Link href="/artist-dashboard" className="quick-link">Artist dashboard</Link> : null}
          <Link href="/fan-dashboard" className="quick-link">Fan dashboard</Link>
        </div>
      </section>
    </main>
  );
}
