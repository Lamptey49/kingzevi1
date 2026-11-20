import Link from 'next/link';
import { fetchJson } from '../../lib/api';

async function getDashboardData() {
  try {
    const data = await fetchJson('/api/social/stats');
    return {
      totalPosts: data.total_posts ?? 0,
      totalComments: data.total_comments ?? 0,
      totalLikes: data.total_likes ?? 0,
      activeFans: data.active_fans ?? 0,
    };
  } catch {
    return { totalPosts: 0, totalComments: 0, totalLikes: 0, activeFans: 0 };
  }
}

export default async function FanDashboardPage() {
  const stats = await getDashboardData();

  return (
    <main className="page-shell">
      <section className="hero-card compact">
        <p className="eyebrow">Fan Dashboard</p>
        <h1>Stay close to the community.</h1>
        <p className="hero-copy">
          The fan dashboard is now reading the live social stats from the Express API.
        </p>
        <Link href="/" className="secondary-btn">Back home</Link>
      </section>

      <section className="grid stats-grid">
        <article className="card">
          <h2>{stats.totalPosts}</h2>
          <p>Posts</p>
        </article>
        <article className="card">
          <h2>{stats.totalComments}</h2>
          <p>Comments</p>
        </article>
        <article className="card">
          <h2>{stats.totalLikes}</h2>
          <p>Likes</p>
        </article>
        <article className="card">
          <h2>{stats.activeFans}</h2>
          <p>Active fans</p>
        </article>
      </section>
    </main>
  );
}
