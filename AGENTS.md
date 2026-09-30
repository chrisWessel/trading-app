# AGENTS.md

## Git workflow

- **Always push after committing.** The user relies on `origin/main` being current
  so the Vercel deploy picks up every change. After any commit, run
  `git push origin main` as part of the same task. Do not wait to be asked.
- Commit and push only the files you actually changed; never stage build output.
- Do not amend, force-push, or skip hooks.

## Project layout

- `backend/` — FastAPI + uvicorn, served on `127.0.0.1:8000`
- `frontend/` — Next.js 14 App Router, served on `localhost:3000`
- `run_app.bat` — starts both servers in separate windows

## Commands

Backend:

```
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Frontend (run from `frontend/`):

```
npm run dev      # dev server
npm run build    # production build (delete .next first if output looks stale)
npx tsc --noEmit # typecheck
```

## Gotchas

- **Do not run `npx next start`.** `npx` resolves a *different, newer* Next.js
  (16.x) than the project's local 14.2.35. It fails with
  "Could not find a production build" and can clobber `.next`. Use the local
  binary instead:
  `node node_modules\next\dist\bin\next start -p 3100`
- Never run `next dev` and `next start` at the same time — the dev server
  overwrites `.next` and breaks the production server.
- The backend has no WebSocket library installed, so `/ws/candles/...` returns
  404. This is expected locally, not a regression.
- Vercel builds from `main`; a local commit that is not pushed will not deploy.

## Frontend gotchas that caused real bugs

- **Never call `new Date()` during render** in a client component. It breaks
  hydration (React #418/#423/#425) because the server and client text differ.
  Render a neutral placeholder and fill it in from a `useEffect` after mount.
  `MarketSessionClocks.tsx` does this.
- **The TradingView widget has no guaranteed event API.** `new TradingView.widget()`
  may return an instance without `.on`. Always check
  `typeof w.on === 'function'` before calling it, fall back to polling
  `w.chart()`, and wrap widget init in `try/catch`. An exception thrown
  synchronously inside `useEffect` tears down the entire React root and shows
  "Application error: a client-side exception has occurred".
- **Every TradingView widget must be torn down on unmount**
  (`widget.remove()` plus clearing the container). Without this, switching tabs
  leaks iframes onto `window.TradingView` and eventually breaks the page.
- There is no `error.tsx` or `global-error.tsx`, so any uncaught client error
  takes down the whole page. Handle errors at the source.
