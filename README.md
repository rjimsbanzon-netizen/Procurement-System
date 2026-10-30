# ProcureFlow — React + TypeScript conversion

Your **enterprise.html** is now split into React `.tsx` screens, shared TypeScript
modules, domain actions, Cloudflare API services and styles. Original procurement
workflows, the copper/forest theme, localStorage mode and the Cloudflare endpoints
are retained.

## Run

```bash
npm install
# Optional: copy .env.example to .env and set VITE_API_BASE_URL
# On Windows Command Prompt: copy .env.example .env
npm run dev
```

Build for Cloudflare Pages using `npm run build` with output folder **dist**.
Vite's output is the static UI. Your **existing Cloudflare Worker/D1 API must be running separately**; this
package does not include a database server. Set `VITE_API_BASE_URL` to the
Worker's base URL (for example, `https://procurecorp-api.YOUR_ACCOUNT.workers.dev`).

## Layout

- `src/pages/*.tsx` — React screen components for each procurement section.
- `src/components/*.tsx` — React app shell, header, sidebar, auth, modal and HTML adapter.
- `src/views/*.ts` — original screen HTML generation logic, split per screen.
- `src/views/modals/*.ts` — individual modal templates.
- `src/actions/*.ts` — requisition, bidding, orders, amendment, user actions.
- `src/events/*.ts` — existing form/event handlers.
- `src/services/*.ts` — cloud sessions, local/cloud persistence, audit, notifications.
- `src/domain/*.ts` — authorization and business rules.
- `src/store/state.ts` — application state and UI navigation state.
- `src/data/initialState.ts` — original demo records and permissions.
- `src/styles/enterprise.css` — original styling; Tailwind is now compiled locally.

## Migration notes

This is a **working compatibility refactor**, not a full rewrite of every table
and modal to idiomatic React state. To preserve a large existing system, each
`.tsx` page hosts its original `.ts` view template in `HtmlView`. Event handling
is delegated to a specific command whitelist rather than executing inline JS.
Forms still use the original DOM event handlers in `src/events`; `renderApp()` now
sends React a state-change notification. As you update each screen, you can move
its templates into native JSX in stages without touching unrelated workflows.

**Security:** Local demo mode preserves original demo-user credentials in
localStorage. Do **not** use this local mode for real accounts or payments.
Use your Cloudflare Worker to authenticate users and enforce permissions on
**every API request**; client-side permission checks alone do not provide security.
Do not put secret API keys or database credentials in `VITE_*` variables.

**Assets:** The ProcureFlow mark is stored at `src/procureflow-mark.png` and bundled
by Vite for the app, sidebar, and favicon.

**HTML adapter security:** Templates use `dangerouslySetInnerHTML` for compatibility.
Before serving untrusted procurement descriptions or names, escape user text or
replace the HTML template views with JSX; never treat UI permission hiding as
backend authorization.
