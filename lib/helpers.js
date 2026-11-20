//  CONFIG
// ─────────────────────────────────────────────────────────────
const API = window.location.origin;   // same-origin; Netlify proxies /api/*

// ─────────────────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────────────────
let me = null;
let token = localStorage.getItem('sl_tok');
let postPage = 1, postPages = 1;
let composeMode = 'text';
let selectedFile = null;
let selectedRole = 'fan';

// ─────────────────────────────────────────────────────────────
//  API HELPER
// ─────────────────────────────────────────────────────────────
async function api(method, path, body, isForm) {
  const h = { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(!isForm && body ? { 'Content-Type': 'application/json' } : {}) };
  const r = await fetch(API + '/api' + path, { method, headers: h, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}

// ─────────────────────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────────────────────
async function init() {
  if (token) {
    try { const d = await api('GET', '/auth/me'); applyUser(d.user, token); }
    catch { token = null; localStorage.removeItem('sl_tok'); }
  }
  updateUI();
  await Promise.all([loadPosts(1), loadStats()]);
  buildStories();
  buildSuggestions();
}

// ─────────────────────────────────────────────────────────────
//  AUTH
// ─────────────────────────────────────────────────────────────


function setRole(r) {
  selectedRole = r;
  document.getElementById('ro-fan').classList.toggle('active', r === 'fan');
  document.getElementById('ro-artist').classList.toggle('active', r === 'artist');
}
function showAuthErr(m) { const e = document.getElementById('auth-err'); e.textContent = m; e.classList.add('show'); }
function clearAuthErr() { document.getElementById('auth-err').classList.remove('show'); }

async function doLogin() {
  clearAuthErr();
  const email = document.getElementById('l-email').value.trim();
  const pass  = document.getElementById('l-pass').value;
  if (!email || !pass) return showAuthErr('Please fill in all fields');
  try {
    const d = await api('POST', '/auth/login', { email, password: pass });
    applyUser(d.user, d.token);
    closeAuth();
    updateUI();
    toast('Welcome back, ' + d.user.username + '! 🎵');
    loadPosts(1);
  } catch (e) { showAuthErr(e.message); }
}

async function doRegister() {
  clearAuthErr();
  const username = document.getElementById('r-user').value.trim();
  const email    = document.getElementById('r-email').value.trim();
  const pass     = document.getElementById('r-pass').value;
  if (!username || !email || !pass) return showAuthErr('Please fill in all fields');
  if (pass.length < 6) return showAuthErr('Password must be at least 6 characters');
  try {
    const d = await api('POST', '/auth/register', { username, email, password: pass, role: selectedRole });
    applyUser(d.user, d.token);
    closeAuth();
    updateUI();
    toast('Welcome to KINGZEVI, ' + d.user.username + '! 🎉');
  } catch (e) { showAuthErr(e.message); }
}

function applyUser(user, tok) {
  me = user;
  token = tok;
  localStorage.setItem('sl_tok', tok);
}

function logout() {
  me = null; token = null;
  localStorage.removeItem('sl_tok');
  updateUI();
  loadPosts(1);
  toast('Signed out. See you soon!');
}

function updateUI() {
  const in_ = !!me;
  // Sidebar
  document.getElementById('sidebar-user').style.display  = in_ ? 'block' : 'none';
  document.getElementById('sidebar-guest').style.display = in_ ? 'none' : 'block';
  document.getElementById('nav-signin').style.display    = in_ ? 'none' : 'flex';
  document.getElementById('nav-upload-btn').style.display = (in_ && me.role === 'artist') ? 'flex' : 'none';
  if (me) {
    document.getElementById('sb-avatar').textContent = me.avatar || '🎧';
    document.getElementById('sb-name').textContent   = me.username;
    document.getElementById('sb-role').textContent   = me.role;
    document.getElementById('composer-av').textContent = me.avatar || '🎧';
  }
  // Mobile nav
  document.getElementById('mob-signin').style.display = in_ ? 'none' : 'flex';
  document.getElementById('mob-user').style.display   = in_ ? 'flex' : 'none';
  if (me) document.getElementById('mob-av').textContent = me.avatar || '🎧';
  // Composer
  document.getElementById('composer-wrap').style.display = in_ ? 'block' : 'none';
}

// ─────────────────────────────────────────────────────────────
//  COMPOSER
// ─────────────────────────────────────────────────────────────
function openComposer(mode = 'text') {
  if (!me) { openAuth('login'); return; }
  document.getElementById('composer-trigger').style.display = 'none';
  document.getElementById('compose-expanded').classList.add('open');
  setComposeMode(mode);
  document.getElementById('compose-text').focus();
}
function closeComposer() {
  document.getElementById('composer-trigger').style.display = '';
  document.getElementById('compose-expanded').classList.remove('open');
  document.getElementById('compose-text').value = '';
  document.getElementById('char-count').textContent = '0 / 1000';
  document.getElementById('waveform').classList.remove('active');
  removeImage();
  document.getElementById('post-submit').disabled = true;
}
function focusComposer() { openComposer('text'); document.getElementById('feed-col').scrollTo({ top: 0, behavior: 'smooth' }); }

function setComposeMode(mode) {
  composeMode = mode;
  document.getElementById('ctab-text').classList.toggle('active', mode === 'text');
  document.getElementById('ctab-image').classList.toggle('active', mode === 'image');
  document.getElementById('img-drop-zone').classList.toggle('visible', mode === 'image' && !selectedFile);
  document.getElementById('img-preview-wrap').classList.toggle('visible', mode === 'image' && !!selectedFile);
  if (mode === 'image' && !selectedFile) {
    // auto-open file picker
  }
  checkPostReady();
}

function onComposeInput() {
  const len = document.getElementById('compose-text').value.length;
  const cc = document.getElementById('char-count');
  cc.textContent = len + ' / 1000';
  cc.className = 'char-count' + (len > 900 ? ' warn' : '');
  document.getElementById('waveform').classList.toggle('active', len > 0);
  checkPostReady();
}

function checkPostReady() {
  const hasText  = document.getElementById('compose-text').value.trim().length > 0;
  const hasImage = !!selectedFile;
  document.getElementById('post-submit').disabled = !hasText && !hasImage;
}

function onImageChosen(input) {
  const file = input.files[0];
  if (!file) return;
  selectedFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('img-preview-el').src = e.target.result;
    document.getElementById('img-preview-wrap').classList.add('visible');
    document.getElementById('img-drop-zone').classList.remove('visible');
  };
  reader.readAsDataURL(file);
  checkPostReady();
}

function removeImage() {
  selectedFile = null;
  document.getElementById('img-preview-el').src = '';
  document.getElementById('img-preview-wrap').classList.remove('visible');
  document.getElementById('img-file').value = '';
  if (composeMode === 'image') document.getElementById('img-drop-zone').classList.add('visible');
  checkPostReady();
}

async function submitPost() {
  if (!me) return openAuth('login');
  const text = document.getElementById('compose-text').value.trim();
  if (!text && !selectedFile) return;

  const btn = document.getElementById('post-submit');
  btn.disabled = true;
  btn.textContent = 'Posting…';

  try {
    const fd = new FormData();
    if (text) fd.append('content', text);
    if (selectedFile) fd.append('image', selectedFile);

    const d = await api('POST', '/social/posts', fd, true);
    closeComposer();
    prependPostEl(buildPostEl(d.post));
    removeSkeleton();
    await loadStats();
    toast('Post shared! 🎉');
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.textContent = 'Post';
    checkPostReady();
  }
}

// ─────────────────────────────────────────────────────────────
//  POSTS
// ─────────────────────────────────────────────────────────────
async function loadPosts(page = 1) {
  if (page === 1) {
    showSkeleton();
    document.getElementById('feed-sub-label').textContent = 'Loading…';
  }
  try {
    const d = await api('GET', `/social/posts?page=${page}&limit=10`);
    postPage = d.page;
    postPages = d.pages;
    if (page === 1) clearFeed();
    d.posts.forEach((p) => appendPostEl(buildPostEl(p)));
    if (page === 1 && d.posts.length === 0) showEmpty();
    document.getElementById('feed-sub-label').textContent = d.total + ' posts from the community';
    document.getElementById('load-more-btn').style.display = postPage < postPages ? 'inline-flex' : 'none';
  } catch {
    clearFeed();
    document.getElementById('feed-list').innerHTML = `
      <div class="empty"><div class="empty-icon">⚠️</div>
      <div class="empty-title">Couldn't load posts</div>
      <div class="empty-sub">Make sure the server is running, then refresh.</div></div>`;
  }
}

async function loadMorePosts() {
  document.getElementById('load-more-btn').textContent = 'Loading…';
  await loadPosts(postPage + 1);
  document.getElementById('load-more-btn').textContent = 'Load more posts';
}

function buildPostEl(post) {
  const isOwn    = me && me.id === post.user_id;
  const isArtist = post.role === 'artist';
  const div = document.createElement('article');
  div.className = 'post-card' + (isArtist ? ' artist-post' : '');
  div.id = 'post-' + post.id;

  div.innerHTML = `
    <div class="post-head">
      <div class="post-avatar${isArtist ? ' artist' : ''}">${esc(post.avatar || '🎧')}</div>
      <div class="post-meta">
        <div class="post-author-row">
          <span class="post-author">${esc(post.username)}</span>
          <span class="role-chip ${post.role}">${post.role}</span>
        </div>
        <div class="post-time">${relTime(post.created_at)}</div>
      </div>
      ${isOwn ? `<button class="post-more" onclick="deletePost('${post.id}')" title="Delete post">⋯</button>` : ''}
    </div>
    ${post.content ? `<div class="post-text">${escNl(post.content)}</div>` : ''}
    ${post.image_url ? `<img class="post-img" src="${esc(post.image_url)}" alt="Post image" loading="lazy" onclick="openLightbox('${esc(post.image_url)}')"/>` : ''}
    <div class="post-actions">
      <button class="action-btn${post.liked_by_me ? ' liked' : ''}" id="like-btn-${post.id}" onclick="toggleLike('${post.id}')">
        ${heartSvg(post.liked_by_me)}
        <span class="action-count" id="like-count-${post.id}">${post.like_count || 0}</span>
      </button>
      <button class="action-btn" onclick="toggleComments('${post.id}')">
        ${commentSvg()}
        <span class="action-count" id="comm-count-${post.id}">${post.comment_count || 0}</span>
      </button>
    </div>
    <div class="comments-wrap" id="comments-wrap-${post.id}">
      <div id="comments-list-${post.id}"></div>
      ${me
        ? `<div class="comment-input-row">
            <div class="comment-avatar">${esc(me.avatar || '🎧')}</div>
            <input class="comment-input" id="ci-${post.id}" placeholder="Write a comment…" onkeydown="if(event.key==='Enter')sendComment('${post.id}')"/>
            <button class="comment-send" onclick="sendComment('${post.id}')">↑</button>
           </div>`
        : `<p style="font-size:.78rem;color:var(--muted);margin-top:6px">
             <span style="color:var(--gold);cursor:pointer" onclick="openAuth('login')">Sign in</span> to comment
           </p>`
      }
    </div>`;
  return div;
}

function prependPostEl(el) {
  const list = document.getElementById('feed-list');
  const empty = list.querySelector('.empty');
  if (empty) list.innerHTML = '';
  list.insertBefore(el, list.firstChild);
}
function appendPostEl(el) { document.getElementById('feed-list').appendChild(el); }

function showSkeleton() {
  document.getElementById('feed-skeleton').style.display = 'block';
}
function removeSkeleton() {
  const sk = document.getElementById('feed-skeleton');
  if (sk) sk.style.display = 'none';
}
function clearFeed() {
  removeSkeleton();
  // Remove all post-card elements, keep skeleton div
  const list = document.getElementById('feed-list');
  [...list.querySelectorAll('.post-card, .empty')].forEach(el => el.remove());
}
function showEmpty() {
  document.getElementById('feed-list').insertAdjacentHTML('beforeend', `
    <div class="empty">
      <div class="empty-icon">📭</div>
      <div class="empty-title">Nothing here yet</div>
      <div class="empty-sub">Be the first to post in the community!</div>
    </div>`);
}

// ─────────────────────────────────────────────────────────────
//  LIKES
// ─────────────────────────────────────────────────────────────
async function toggleLike(postId) {
  if (!me) { openAuth('login'); return; }
  try {
    const d = await api('POST', `/social/posts/${postId}/like`);
    const btn = document.getElementById('like-btn-' + postId);
    btn.className = 'action-btn' + (d.liked ? ' liked' : '');
    btn.querySelector('svg').outerHTML = heartSvg(d.liked);
    document.getElementById('like-count-' + postId).textContent = d.like_count;
  } catch (e) { toast(e.message, true); }
}

// ─────────────────────────────────────────────────────────────
//  COMMENTS
// ─────────────────────────────────────────────────────────────
const loadedComments = new Set();

async function toggleComments(postId) {
  const wrap = document.getElementById('comments-wrap-' + postId);
  const open = wrap.classList.toggle('open');
  if (open && !loadedComments.has(postId)) {
    loadedComments.add(postId);
    await loadComments(postId);
  }
}

async function loadComments(postId) {
  const list = document.getElementById('comments-list-' + postId);
  list.innerHTML = '<p class="no-comments" style="padding:8px 0">Loading…</p>';
  try {
    const d = await api('GET', `/social/posts/${postId}/comments`);
    if (!d.comments.length) {
      list.innerHTML = '<p class="no-comments">No comments yet — be first!</p>';
      return;
    }
    list.innerHTML = d.comments.map(c => buildCommentHtml(c, postId)).join('');
  } catch {
    list.innerHTML = '<p class="no-comments" style="color:var(--coral)">Could not load comments.</p>';
  }
}

function buildCommentHtml(c, postId) {
  const isOwn = me && me.id === c.user_id;
  return `
    <div class="comment-item" id="cmt-${c.id}">
      <div class="comment-avatar">${esc(c.avatar || '🎧')}</div>
      <div class="comment-bubble">
        <div class="comment-name">
          ${esc(c.username)}
          <span class="role-chip ${c.role}" style="font-size:.55rem">${c.role}</span>
          ${isOwn ? `<button class="comment-del" onclick="deleteComment('${c.id}','${postId}')">✕</button>` : ''}
        </div>
        <div class="comment-text">${escNl(c.content)}</div>
      </div>
    </div>`;
}

async function sendComment(postId) {
  if (!me) { openAuth('login'); return; }
  const inp = document.getElementById('ci-' + postId);
  const content = inp.value.trim();
  if (!content) return;
  try {
    const d = await api('POST', `/social/posts/${postId}/comments`, { content });
    inp.value = '';
    const list = document.getElementById('comments-list-' + postId);
    const noMsg = list.querySelector('.no-comments');
    if (noMsg) noMsg.remove();
    list.insertAdjacentHTML('beforeend', buildCommentHtml(d.comment, postId));
    const cc = document.getElementById('comm-count-' + postId);
    if (cc) cc.textContent = parseInt(cc.textContent || 0) + 1;
    await loadStats();
  } catch (e) { toast(e.message, true); }
}

async function deleteComment(id, postId) {
  try {
    await api('DELETE', `/social/comments/${id}`);
    document.getElementById('cmt-' + id)?.remove();
    const cc = document.getElementById('comm-count-' + postId);
    if (cc) cc.textContent = Math.max(0, parseInt(cc.textContent || 0) - 1);
    await loadStats();
  } catch (e) { toast(e.message, true); }
}

// ─────────────────────────────────────────────────────────────
//  DELETE POST
// ─────────────────────────────────────────────────────────────
async function deletePost(id) {
  if (!confirm('Delete this post? This cannot be undone.')) return;
  try {
    await api('DELETE', `/social/posts/${id}`);
    document.getElementById('post-' + id)?.remove();
    await loadStats();
    toast('Post deleted.');
  } catch (e) { toast(e.message, true); }
}

// ─────────────────────────────────────────────────────────────
//  STATS
// ─────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const d = await api('GET', '/social/stats');
    document.getElementById('rp-posts').textContent    = d.total_posts;
    document.getElementById('rp-likes').textContent    = d.total_likes;
    document.getElementById('rp-comments').textContent = d.total_comments;
    document.getElementById('rp-fans').textContent     = d.active_fans;
  } catch {}
}

// ─────────────────────────────────────────────────────────────
//  STORIES (decorative — shows recent users)
// ─────────────────────────────────────────────────────────────
function buildStories() {
  const bar = document.getElementById('stories-bar');
  const users = [
    { name: 'ama_gh', av: '🌟', seen: false },
    { name: 'kwame', av: '🔥', seen: false },
    { name: 'king zevi', av: '🎤', seen: true },
    { name: 'nana_beats', av: '🎹', seen: false },
    { name: 'efua_r', av: '💫', seen: true },
    { name: 'kofi_lp', av: '🎶', seen: false },
  ];
  users.forEach(u => {
    bar.insertAdjacentHTML('beforeend', `
      <div class="story-bubble">
        <div class="story-ring${u.seen ? ' seen' : ''}">
          <div class="story-avatar">${u.av}</div>
        </div>
        <span class="story-name">${u.name}</span>
      </div>`);
  });
}

// ─────────────────────────────────────────────────────────────
//  SUGGESTIONS
// ─────────────────────────────────────────────────────────────
function buildSuggestions() {
  const list = document.getElementById('suggestions-list');
  const people = [
    { name: 'solace_artist', av: '🎤', role: 'artist' },
    { name: 'ama_gh', av: '🌟', role: 'fan' },
    { name: 'kwame_vibes', av: '🔥', role: 'fan' },
  ];
  list.innerHTML = people.map(p => `
    <div class="suggestion-item">
      <div class="sug-avatar">${p.av}</div>
      <div><div class="sug-name">${p.name}</div><div class="sug-role">${p.role}</div></div>
      <button class="sug-follow" onclick="this.classList.toggle('following');this.textContent=this.classList.contains('following')?'Following':'Follow'">Follow</button>
    </div>`).join('');
}

// ─────────────────────────────────────────────────────────────
//  LIGHTBOX
// ─────────────────────────────────────────────────────────────
function openLightbox(src) {
  document.getElementById('lightbox-img').src = src;
  document.getElementById('lightbox').classList.add('open');
}
function closeLightbox() { document.getElementById('lightbox').classList.remove('open'); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeLightbox(); closeAuth(); } });

// ─────────────────────────────────────────────────────────────
//  DRAG & DROP on drop zone
// ─────────────────────────────────────────────────────────────
const dz = document.getElementById('img-drop-zone');
['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('dragging'); }));
['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('dragging'); }));
dz.addEventListener('drop', e => {
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) {
    selectedFile = file;
    const reader = new FileReader();
    reader.onload = ev => {
      document.getElementById('img-preview-el').src = ev.target.result;
      document.getElementById('img-preview-wrap').classList.add('visible');
      dz.classList.remove('visible');
    };
    reader.readAsDataURL(file);
    checkPostReady();
  }
});

// ─────────────────────────────────────────────────────────────
//  TOAST
// ─────────────────────────────────────────────────────────────
function toast(msg, isErr = false) {
  const wrap = document.getElementById('toast-wrap');
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  wrap.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3000);
}

// ─────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────
function scrollFeedTop() { document.getElementById('feed-col').scrollTo({ top: 0, behavior: 'smooth' }); }
function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escNl(s) { return esc(s).replace(/\n/g, '<br>'); }
function relTime(ts) {
  const d = (Date.now() - new Date(ts + (ts.includes('Z') || ts.includes('+') ? '' : 'Z'))) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return Math.floor(d / 60) + 'm ago';
  if (d < 86400) return Math.floor(d / 3600) + 'h ago';
  return Math.floor(d / 86400) + 'd ago';
}
function heartSvg(filled) {
  return `<svg viewBox="0 0 24 24"><path d="${filled
    ? 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'
    : 'M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z'
  }"/></svg>`;
}
function commentSvg() {
  return `<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>`;
}

// Enter key on login
document.getElementById('l-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
document.getElementById('r-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doRegister(); });

init();