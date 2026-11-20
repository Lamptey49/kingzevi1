import Link from 'next/link';
import { fetchJson } from '../../lib/api';

async function getMusic() {
  try {
    const data = await fetchJson('/api/music');
    return data.music ?? [];
  } catch {
    return [];
  }
}

export default async function MusicPage() {
  const releases = await getMusic();

  return (
    <main className="page-shell">
      <section className="hero-card compact">
        <p className="eyebrow">Music</p>
        <h1>Discover the latest releases.</h1>
        <p className="hero-copy">
          The Next.js frontend is now reading the live Express music API.
        </p>
        <Link href="/" className="secondary-btn">Back home</Link>
      </section>

      <section className="grid">
        {releases.map((release) => (
          <article key={release.id} className="card">
            <p className="eyebrow">{release.type}</p>
            <h2>{release.title}</h2>
            <p>{release.description || 'No description provided yet.'}</p>
            <p><strong>Artist:</strong> {release.artist_name}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
