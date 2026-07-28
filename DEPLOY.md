# Hosting RBC Treasury Intelligence on the web

Goal: a stable URL that works on a locked-down **work computer** and keeps **all**
functionality (AI chat, live market data, PDF source viewer, and the refresh
"Apply" that writes to disk).

Why not Vercel: its serverless filesystem is read-only, which would break the
refresh "Apply". Use a **persistent Node host** — Render (recommended) or Railway.
Both serve on a normal `*.onrender.com` / `*.up.railway.app` domain that corporate
firewalls treat as an ordinary website (not a blockable tunnel).

The repo is already deploy-ready — `render.yaml` configures everything. You only
provide the account and the API key (I can't create accounts or log in as you).

---

## Path A — Render (recommended, free, near one-click)

**1. Put the code on GitHub** (one-time). Create an empty repo at github.com (e.g. `rbc-treasury-iq`), then from this folder:

```bash
git remote add origin https://github.com/<your-username>/rbc-treasury-iq.git
git push -u origin main
```

**2. Deploy the blueprint.** At [render.com](https://render.com) → sign up (you can "Sign in with GitHub") → **New +** → **Blueprint** → select the repo. Render reads `render.yaml` automatically.

**3. Paste your key.** When prompted for `ANTHROPIC_API_KEY`, paste it (from your local `.env.local`). Click **Apply**.

**4. Wait ~3–5 min.** You get a live URL like `https://rbc-treasury-iq.onrender.com`. Open it from any device, including your work computer.

Login: `ctocmembers` / `rbc`.

---

## Path B — Railway (alternative, no GitHub needed)

```bash
npm i -g @railway/cli
railway login            # opens a browser to authenticate
railway init             # create a project
railway up               # deploys straight from this folder
railway variables set ANTHROPIC_API_KEY=sk-ant-...
railway domain           # generates a public https URL
```

Railway auto-detects Next.js and runs `npm run build` / `npm start`. (Requires a payment method after the trial credit.)

---

## Things to know

- **Free-tier cold start (Render):** the free plan sleeps after ~15 min idle and takes ~50s to wake on the next request. For a live demo, either open the URL a minute before you present, or upgrade to the `starter` plan ($7/mo) in `render.yaml` (`plan: starter`) for always-on.
- **API-key exposure:** the UI is behind the team passcode, but `/api/chat` isn't itself auth-gated, so anyone with the URL could spend Anthropic credits via the assistant. Keep the URL private, or ask me to add a passcode check to the API routes.
- **Refresh "Apply" persistence:** the write works at runtime, but the container resets to the committed data on each redeploy (applied quarters revert). To persist across redeploys, add a Render persistent disk mounted at `data/` — ask me and I'll wire a `DATA_DIR` env for it.
- **Node version** is pinned to 22 in `render.yaml`; bump it there if a build ever needs newer.

## Run locally

```bash
npm install
npm run build && npm start   # production server on http://localhost:3000
# or: npm run dev             # dev server with hot reload
```
