# Deploying KZ: Netlify (frontend) + Render (backend)

## Why two platforms?

| Layer    | What it does                        | Platform  |
|----------|-------------------------------------|-----------|
| Frontend | Serves `public/index.html` to fans  | Netlify   |
| Backend  | Express API + SQLite database       | Render    |

Netlify proxies every `/api/*` call to Render, so the browser
always talks to one domain — no CORS headaches, no code changes.

---

## Step 1 — Deploy the backend to Render

1. Push this repo to GitHub (or GitLab).

2. Go to **https://render.com** → New → Web Service.

3. Connect your GitHub repo. Render auto-detects `render.yaml`
   and pre-fills most settings. Verify:

   | Setting        | Value              |
   |----------------|--------------------|
   | Runtime        | Node                |
   | Build Command  | `npm install`       |
   | Start Command  | `node server.js`    |
   | Plan           | Free                |

4. Under **Environment Variables**, add:

   | Key              | Value                                    |
   |------------------|------------------------------------------|
   | `NODE_ENV`       | `production`                             |
   | `JWT_SECRET`     | (click "Generate" for a random value)    |
   | `DB_PATH`        | `./solace.db`                        |
   | `ALLOWED_ORIGIN` | *(leave blank for now — fill after step 2)* |

5. Under **Disks**, add a disk:
   - Name: `solace-data`
   - Mount Path: `./`
   - Size: 1 GB

6. Click **Create Web Service**. Wait for the first deploy (~2 min).

7. Copy your Render URL — it looks like:
   ```
   https://solace-backend-xxxx.onrender.com
   ```

---

## Step 2 — Configure Netlify

1. Open `netlify.toml` and replace both `YOUR-APP-NAME` placeholders
   with your actual Render subdomain:

   ```toml
   # Before
   to = "https://YOUR-APP-NAME.onrender.com/api/:splat"

   # After (example)
   to = "https://solace-backend-xxxx.onrender.com/api/:splat"
   ```

   Do the same for the `/uploads/*` redirect.

2. Commit and push the change.

3. Go to **https://app.netlify.com** → Add new site → Import from Git.

4. Select your repo. Settings:

   | Setting          | Value            |
   |------------------|------------------|
   | Publish directory | `public`        |
   | Build command    | *(leave empty)*  |

5. Click **Deploy site**. Netlify builds in seconds.

6. Copy your Netlify URL, e.g. `https://solace-music.netlify.app`.

---

## Step 3 — Wire them together

1. Back in **Render** → your service → Environment → edit `ALLOWED_ORIGIN`:
   ```
   https://solace-music.netlify.app
   ```

2. Click **Save** — Render redeploys automatically (~1 min).

3. Visit your Netlify URL. Open DevTools → Network.
   `/api/music?type=album` should return **200**, proxied through Netlify.

---

## Verify the proxy is working

```bash
# Should return JSON from your Render backend
curl https://solace-music.netlify.app/api/health

# Should list albums from SQLite
curl https://solace-music.netlify.app/api/music?type=album
```

---

## Custom domain (optional)

Add your domain in both Netlify (Site settings → Domain management)
and update `ALLOWED_ORIGIN` in Render to match.

---

## Free-tier note

Render's free plan spins down after 15 minutes of inactivity.
The first request after a spin-down takes ~30 seconds (cold start).
Upgrade to the $7/month "Starter" plan for always-on hosting.

---

## Local development (no changes needed)

```bash
cp .env.example .env
# edit .env: set JWT_SECRET, leave DB_PATH blank
npm install
node server.js
# open http://localhost:3000
```

The backend serves both the API and the frontend locally,
so you don't need Netlify running on your machine.
