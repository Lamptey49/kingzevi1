import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const post = (id) => ({ id, user_id: 'user', username: 'Fan', role: 'fan', content: 'Saved post', created_at: new Date().toISOString(), avatar: '🎧', avatar_url: 'https://res.cloudinary.com/demo/image/upload/avatar.jpg' });
const tick = () => new Promise(resolve => setImmediate(resolve));
for (const page of ['index', 'social']) {
  function setup(fetcher) {
    const html = readFileSync(`public/${page}.html`, 'utf8');
    const dom = new JSDOM(html, { url: 'http://localhost', runScripts: 'outside-only', pretendToBeVisual: true });
    dom.window.fetch = fetcher;
    dom.window.AbortSignal = AbortSignal;
    const script = page === 'index' ? readFileSync('public/JS/helper.js', 'utf8') : html.match(/<script>([\s\S]*?)<\/script>/)[1];
    dom.window.eval(script);
    return dom;
  }
  const response = data => ({ ok: true, json: async () => data });

  test(`${page}: follow and share controls persist actions and switch to Following`, async () => {
    const writes = []; let following = false, shared = false;
    const dom = setup(async (url, options) => {
      if (url.endsWith('/follow')) { writes.push(options.method); following = options.method === 'PUT'; return response({ following }); }
      if (url.endsWith('/share')) { writes.push(options.method); shared = options.method === 'PUT'; return response({ shared }); }
      if (url.includes('/posts?')) return response({ posts: [{ ...post('one'), following_author: following, shared_by_me: shared, share_count: shared ? 1 : 0 }], has_more: false });
      return response({ users: [] });
    });
    await tick();
    dom.window.applyUser({ id: 'viewer', username: 'viewer', role: 'fan' }, 'token');
    let follow = dom.window.document.querySelector('[data-follow-user="user"]');
    await dom.window.toggleFollow(follow);
    assert.equal(follow.textContent, 'Following');
    await dom.window.setFeed('following');
    let share = dom.window.document.querySelector('[data-share-post="one"]');
    await dom.window.sharePost(share);
    share = dom.window.document.querySelector('[data-share-post="one"]');
    assert.match(share.textContent, /Undo share/);
    await dom.window.sharePost(share);
    assert.deepEqual(writes, ['PUT', 'PUT', 'DELETE']);
    dom.window.close();
  });

  test(`${page}: share link uses native sharing or copies a direct post URL`, async () => {
    const dom = setup(async url => url.includes('/posts?') ? response({ posts: [post('one')], has_more: false }) : response({}));
    await tick();
    const shareMenu = dom.window.document.querySelector('.post-share');
    assert.equal(dom.window.document.querySelectorAll('.post-share-trigger').length, 1);
    assert.equal(shareMenu.open, false);
    assert.ok(shareMenu.querySelector('[data-share-post="one"]'));
    assert.ok(shareMenu.querySelector('[data-share-link="one"]'));
    assert.ok(shareMenu.querySelector('[data-copy-link="one"]'));
    shareMenu.open = true;
    const button = shareMenu.querySelector('[data-share-link="one"]');
    let shared;
    Object.defineProperty(dom.window.navigator, 'share', { configurable: true, value: async value => { shared = value; } });
    await dom.window.sharePostLink(button);
    assert.equal(shared.url, 'http://localhost/#post-one');
    assert.equal(shared.title, 'KINGZEVI');
    assert.equal(shareMenu.open, false);
    dom.window.close();

    const fallbackDom = setup(async url => url.includes('/posts?') ? response({ posts: [post('two')], has_more: false }) : response({}));
    await tick();
    let copied;
    Object.defineProperty(fallbackDom.window.navigator, 'clipboard', { configurable: true, value: { writeText: async value => { copied = value; } } });
    await fallbackDom.window.copyPostLink(fallbackDom.window.document.querySelector('[data-copy-link="two"]'));
    assert.equal(copied, 'http://localhost/#post-two');
    fallbackDom.window.close();
  });

  test(`${page}: real page starts, loads saved posts, shows pictures, and stops at last page`, async () => {
    let calls = 0;
    const dom = setup(async url => {
      if (url.includes('/posts?')) { calls++; return response({ posts: [post('one')], page: 1, pages: 1, total: 1, has_more: false }); }
      return response({});
    });
    await tick();
    const document = dom.window.document;
    assert.equal(calls, 1);
    assert.equal(document.querySelectorAll('.post-card').length, 1);
    assert.equal(document.querySelector('#post-one img').src, post('one').avatar_url);
    if (page === 'index') assert.equal(document.querySelector('.post-author-link').href, 'http://localhost/social.html?profile=Fan');
    const button = document.getElementById(page === 'index' ? 'load-more' : 'load-more-btn');
    assert.equal(button.style.display, 'none');
    await dom.window.loadMorePosts();
    assert.equal(calls, 1);
    if (page === 'index') assert.equal(document.querySelector('#posts-feed > .loading-state'), null);
    else assert.equal(document.getElementById('feed-skel').style.display, 'none');
    dom.window.close();
  });
  test(`${page}: older page errors keep posts and retry; concurrent clicks request once`, async () => {
    let calls = 0, release;
    const dom = setup(async url => {
      if (!url.includes('/posts?')) return response({});
      calls++;
      if (calls === 1) return response({ posts: [post('one')], total: 2, has_more: true, next_cursor: 'older' });
      if (calls === 2) return new Promise((resolve, reject) => { release = () => reject(new Error('offline')); });
      assert.ok(url.includes('cursor=older'));
      return response({ posts: [post('two')], total: 2, has_more: false });
    });
    await tick();
    const pending = dom.window.loadMorePosts();
    await dom.window.loadMorePosts();
    assert.equal(calls, 2);
    release(); await pending;
    assert.equal(dom.window.document.querySelectorAll('.post-card').length, 1);
    assert.ok(dom.window.document.querySelector('.feed-error'));
    await dom.window.loadMorePosts();
    assert.equal(dom.window.document.querySelectorAll('.post-card').length, 2);
    assert.equal(dom.window.document.querySelector('.feed-error'), null);
    dom.window.close();
  });
  test(`${page}: empty and failed initial loads clear loading indicators`, async () => {
    let fail = true;
    const dom = setup(async url => {
      if (url.includes('/posts?') && fail) throw new Error('timeout');
      return response({ posts: [], total: 0, has_more: false });
    });
    await tick();
    assert.ok(dom.window.document.querySelector('.feed-error'));
    fail = false;
    await dom.window.loadPosts(1);
    assert.equal(dom.window.document.querySelector('.feed-error'), null);
    assert.equal(dom.window.document.querySelectorAll('.post-card').length, 0);
    dom.window.close();
  });
  test(`${page}: a stale refresh cannot replace a newer response`, async () => {
    let count = 0, release;
    const dom = setup(async url => {
      if (!url.includes('/posts?')) return response({});
      count++;
      if (count === 2) return new Promise(resolve => { release = () => resolve(response({ posts: [post('stale')], has_more: false })); });
      return response({ posts: [post(count === 1 ? 'one' : 'fresh')], has_more: false });
    });
    await tick();
    const stale = dom.window.loadPosts(1);
    await dom.window.loadPosts(1);
    release(); await stale;
    assert.ok(dom.window.document.getElementById('post-fresh'));
    assert.equal(dom.window.document.getElementById('post-stale'), null);
    dom.window.close();
  });
}

test('shared script still initializes the music page without requesting a feed', async () => {
  const html = readFileSync('public/music.html', 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost', runScripts: 'outside-only' });
  const urls = [];
  dom.window.AbortSignal = AbortSignal;
  dom.window.fetch = async url => { urls.push(url); return { ok: true, json: async () => ({ music: [] }) }; };
  dom.window.eval(readFileSync('public/JS/helper.js', 'utf8'));
  await tick();
  assert.equal(urls.filter(url => url.includes('/music?')).length, 2);
  assert.equal(urls.filter(url => url.includes('/social/')).length, 0);
  assert.match(dom.window.document.getElementById('singles-grid').textContent, /No singles/);
  dom.window.close();
});

test('dashboard prefers the saved Cloudinary profile picture', () => {
  const dom = new JSDOM(readFileSync('public/fan-dashboard.html', 'utf8'), { url: 'http://localhost', runScripts: 'outside-only' });
  dom.window.localStorage.setItem('st', 'test');
  dom.window.fetch = async () => ({ ok: true, json: async () => ({ user: { username: 'fan', avatar_url: post('one').avatar_url } }) });
  dom.window.AbortSignal = AbortSignal;
  dom.window.eval(readFileSync('public/JS/fan-dashboard.js', 'utf8'));
  dom.window.applyUserToPage({ username: 'fan', avatar: '🎧', avatar_url: post('one').avatar_url });
  assert.equal(dom.window.document.querySelector('#fan-avatar-preview img').src, post('one').avatar_url);
  dom.window.close();
});
