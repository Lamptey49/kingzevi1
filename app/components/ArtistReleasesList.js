'use client';

import { useEffect, useState } from 'react';
import { fetchJson } from '../../lib/api';
import { useAuth } from '../context/AuthContext';

export default function ArtistReleasesList() {
  const { user } = useAuth();
  const [releases, setReleases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const loadReleases = () => {
    if (!user || user.role !== 'artist') {
      setLoading(false);
      return;
    }

    const token = window.localStorage.getItem('kingzevi_token');
    setLoading(true);
    fetchJson('/api/music', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((data) => setReleases(data.music || []))
      .catch(() => setMessage('Unable to load releases.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadReleases();
  }, [user]);

  const handleDelete = async (releaseId) => {
    const token = window.localStorage.getItem('kingzevi_token');
    try {
      const response = await fetchJson(`/api/music/${releaseId}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      setMessage('Release deleted successfully.');
      loadReleases();
    } catch (error) {
      setMessage(error.message);
    }
  };

  if (!user || user.role !== 'artist') return null;

  return (
    <section className="card auth-card">
      <p className="eyebrow">Your releases</p>
      <h2>Uploaded music</h2>
      {message ? <p className="message-box">{message}</p> : null}
      {loading ? (
        <p className="message-box">Loading releases…</p>
      ) : releases.length === 0 ? (
        <p>No releases yet.</p>
      ) : (
        <div className="grid">
          {releases.map((release) => (
            <article key={release.id} className="card">
              <h3>{release.title}</h3>
              <p>{release.description || 'No description provided.'}</p>
              <p><strong>Type:</strong> {release.type}</p>
              <p><strong>Artist:</strong> {release.artist_name}</p>
              <button className="secondary-btn" onClick={() => handleDelete(release.id)}>
                Delete
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
