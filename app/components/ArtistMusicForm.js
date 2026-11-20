'use client';

import { useState } from 'react';
import { fetchJson } from '../../lib/api';
import { useAuth } from '../context/AuthContext';

export default function ArtistMusicForm() {
  const { user } = useAuth();
  const [form, setForm] = useState({
    type: 'single',
    title: '',
    genre: '',
    year: '',
    emoji: '',
    description: '',
    allow_download: 'true',
  });
  const [file, setFile] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!user || user.role !== 'artist') return;

    setLoading(true);
    setMessage('');

    const formData = new FormData();
    formData.append('type', form.type);
    formData.append('title', form.title);
    formData.append('genre', form.genre);
    formData.append('year', form.year);
    formData.append('emoji', form.emoji);
    formData.append('description', form.description);
    formData.append('allow_download', form.allow_download);
    if (file) formData.append('audio', file);

    try {
      const token = window.localStorage.getItem('kingzevi_token');
      const response = await fetchJson('/api/music', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });

      setMessage(`Created ${form.type === 'album' ? 'album' : 'single'} successfully.`);
      setForm({
        type: 'single',
        title: '',
        genre: '',
        year: '',
        emoji: '',
        description: '',
        allow_download: 'true',
      });
      setFile(null);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="card auth-card" onSubmit={handleSubmit}>
      <p className="eyebrow">Upload music</p>
      <label>
        Type
        <select name="type" value={form.type} onChange={handleChange}>
          <option value="single">Single</option>
          <option value="album">Album</option>
        </select>
      </label>

      <label>
        Title
        <input name="title" value={form.title} onChange={handleChange} required />
      </label>

      <label>
        Genre
        <input name="genre" value={form.genre} onChange={handleChange} />
      </label>

      <label>
        Year
        <input name="year" value={form.year} onChange={handleChange} placeholder="2026" />
      </label>

      <label>
        Emoji
        <input name="emoji" value={form.emoji} onChange={handleChange} placeholder="🎵" />
      </label>

      <label>
        Description
        <textarea name="description" value={form.description} onChange={handleChange} rows="4" />
      </label>

      <label>
        Allow downloads
        <select name="allow_download" value={form.allow_download} onChange={handleChange}>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </label>

      <label>
        Audio file
        <input type="file" accept="audio/*" onChange={(event) => setFile(event.target.files?.[0] || null)} />
      </label>

      {message ? <p className="message-box">{message}</p> : null}

      <button className="primary-btn" type="submit" disabled={loading}>
        {loading ? 'Uploading...' : 'Publish music'}
      </button>
    </form>
  );
}
