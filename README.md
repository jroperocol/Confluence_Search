# Confluence Table Scraper (Playwright, Session Reuse)

## Install dependencies

```bash
npm init -y
npm install playwright
npx playwright install chromium
```

## Script file

Use `confluence-table-scraper.js`.

## 1) First run: manual login and save session

Run this once to open a browser, complete SSO manually, then press ENTER in terminal to save cookies/session:

```bash
node confluence-table-scraper.js --login --headed
```

By default, session is saved to:

```text
auth/storageState.json
```

## 2) Reuse saved session (no login)

```bash
node confluence-table-scraper.js --headless
```

If you prefer a visible browser:

```bash
node confluence-table-scraper.js --headed
```

## Optional flags

- `--url <url>` override Confluence page URL.
- `--state <path>` custom storage state path.
- `--timeout <ms>` custom wait timeout.

Example:

```bash
node confluence-table-scraper.js --state ./auth/storageState.json --timeout 90000 --headless
```

## Behavior and constraints

- Uses **only browser session reuse** (`storageState`).
- Does **not** use API tokens.
- Does **not** use basic auth.
- Waits for dynamic table rendering.
- Extracts table rows and prints structured JSON to console.
- If session expires and page redirects to login, script exits with clear error and asks to rerun with `--login`.
