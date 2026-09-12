# AffordMatch dashboards (frontend)

Three static single-page apps — buyer, provider, admin — plain HTML/CSS/JS,
no build tooling, no framework. They call a separately-deployed API over
REST; see `affordmatch-backend` for that half.

## Run it locally

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

`shared/config.js` defaults to `http://localhost:4000`, so this works
out of the box against a locally-running backend. No build step needed
for local dev.

## Deploying

These are static files, so **no Docker and no Node runtime needed at
deploy time** — just a place to host static files, plus one small step
to point them at your deployed backend's URL, since that's baked into
`shared/config.js` rather than read at runtime.

### Render (Static Site — not a Web Service)

1. Push this repo, then in Render: **New + → Static Site** → connect it.
2. **Build Command:** `sh generate-config.sh`
3. **Publish Directory:** `.` (repo root)
4. Under **Environment**, add `API_BASE_URL` set to your backend's public
   URL (e.g. `https://affordmatch-api.onrender.com`, no trailing slash).
5. Deploy. The build command writes `shared/config.js` using that env
   var before Render publishes the files — nothing to configure beyond
   that one variable.

This is a genuinely different service type from the backend's ("Static
Site" vs "Web Service"), so there's no Dockerfile-path confusion here —
Render doesn't build a container for static sites at all.

### Netlify / Vercel

Same idea on either platform:
- **Build command:** `sh generate-config.sh`
- **Publish/output directory:** `.` (repo root)
- **Environment variable:** `API_BASE_URL` = your backend's public URL

### Simplest possible option (no build step at all)

If your host doesn't support build commands, skip `generate-config.sh`
entirely and just hand-edit `shared/config.js` before deploying:

```js
window.AFFORDMATCH_API_BASE = "https://your-backend-url.onrender.com";
```

Commit that change, deploy the files as-is. Less automated, but there's
nothing to misconfigure.

## Demo logins

Password for all: `Password123!` — see the backend README for the full
seeded account list (admin, buyer, and one provider per vertical).

## Project layout

```
├── index.html            landing page linking to the three apps
├── buyer/index.html       affordability calculator + matches + my requests
├── provider/index.html    qualified lead dashboard + inventory management
├── admin/index.html       platform overview, providers, buyers, leads
├── shared/
│   ├── api.js             fetch client (reads window.AFFORDMATCH_API_BASE)
│   ├── config.js          API base URL — regenerated at build/deploy time
│   └── styles.css         shared design tokens and components
└── generate-config.sh      writes shared/config.js from $API_BASE_URL
```
