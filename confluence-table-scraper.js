#!/usr/bin/env node

/**
 * Confluence Table Scraper (Playwright, session reuse via storageState)
 *
 * Usage examples:
 *   node confluence-table-scraper.js --login --headed
 *   node confluence-table-scraper.js --headless
 *   node confluence-table-scraper.js --state ./auth/storageState.json --url https://... --headed
 */

const fs = require('fs/promises');
const path = require('path');
const { chromium } = require('playwright');

const DEFAULT_URL =
  'https://broadvoice-jira.atlassian.net/wiki/spaces/NS2OC/pages/3317039695/PROC00024+-+Elastic+Cloud+Instances';
const DEFAULT_STATE_PATH = path.resolve(process.cwd(), 'auth', 'storageState.json');
const DEFAULT_TIMEOUT_MS = 60_000;

function parseArgs(argv) {
  const args = {
    login: false,
    headless: true,
    url: DEFAULT_URL,
    statePath: DEFAULT_STATE_PATH,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === '--login') {
      args.login = true;
    } else if (token === '--headless') {
      args.headless = true;
    } else if (token === '--headed') {
      args.headless = false;
    } else if (token === '--url') {
      args.url = argv[i + 1];
      i += 1;
    } else if (token === '--state') {
      args.statePath = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
    } else if (token === '--timeout') {
      args.timeoutMs = Number(argv[i + 1]);
      i += 1;
    } else if (token === '--help' || token === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return args;
}

function printHelp() {
  // eslint-disable-next-line no-console
  console.log(`
Confluence Table Scraper (Playwright)

Options:
  --login            Open browser for manual login and save storageState.
  --headless         Run browser headless (default for scrape mode).
  --headed           Run browser with visible UI.
  --url <url>        Confluence page URL.
  --state <path>     Path for storageState json.
  --timeout <ms>     Navigation/wait timeout in ms (default: 60000).
  -h, --help         Show help.
`);
}

async function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

function isLikelyLoginPage(url) {
  const lowered = url.toLowerCase();
  return (
    lowered.includes('/login') ||
    lowered.includes('id.atlassian.com') ||
    lowered.includes('auth') ||
    lowered.includes('sso')
  );
}

async function runLoginFlow({ url, statePath, headless, timeoutMs }) {
  await ensureDirForFile(statePath);

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);

  try {
    // eslint-disable-next-line no-console
    console.log(`Opening login page: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // eslint-disable-next-line no-console
    console.log('\nManual login required. Complete SSO in the opened browser window.');
    // eslint-disable-next-line no-console
    console.log('When the Confluence page is fully loaded, press ENTER here to save session...\n');

    await new Promise((resolve) => {
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      process.stdin.once('data', () => resolve());
    });

    await context.storageState({ path: statePath });
    // eslint-disable-next-line no-console
    console.log(`Session saved to: ${statePath}`);
  } finally {
    await browser.close();
  }
}

async function assertStateFileExists(statePath) {
  try {
    await fs.access(statePath);
  } catch {
    throw new Error(
      `No storageState file found at: ${statePath}\nRun with --login first to create an authenticated session.`
    );
  }
}

async function waitForConfluenceTable(page, timeoutMs) {
  const tableSelector = 'table';
  await page.waitForSelector(tableSelector, { state: 'visible', timeout: timeoutMs });
  return tableSelector;
}

async function extractTablesAsJson(page, tableSelector) {
  return page.$$eval(tableSelector, (tables) => {
    const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();

    return tables
      .map((table, tableIndex) => {
        const headerCells = Array.from(table.querySelectorAll('thead tr th')).map((th) =>
          normalize(th.textContent)
        );

        const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
        const fallbackRows = bodyRows.length ? bodyRows : Array.from(table.querySelectorAll('tr'));

        const rows = fallbackRows
          .map((tr, rowIndex) => {
            const cells = Array.from(tr.querySelectorAll('th, td')).map((cell) =>
              normalize(cell.textContent)
            );

            if (!cells.length) return null;

            const rowObject = {};
            cells.forEach((value, cellIndex) => {
              const key =
                headerCells[cellIndex] && headerCells[cellIndex].length
                  ? headerCells[cellIndex]
                  : `column_${cellIndex + 1}`;
              rowObject[key] = value;
            });

            return {
              rowIndex,
              cells,
              rowObject,
            };
          })
          .filter(Boolean);

        return {
          tableIndex,
          headers: headerCells,
          rowCount: rows.length,
          rows,
        };
      })
      .filter((t) => t.rowCount > 0);
  });
}

async function scrapeWithSavedSession({ url, statePath, headless, timeoutMs }) {
  await assertStateFileExists(statePath);

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ storageState: statePath });
  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    if (isLikelyLoginPage(page.url())) {
      throw new Error(
        'Session appears expired or unauthenticated (redirected to login). Run again with --login to refresh storageState.'
      );
    }

    const tableSelector = await waitForConfluenceTable(page, timeoutMs);
    const tables = await extractTablesAsJson(page, tableSelector);

    if (!tables.length) {
      throw new Error('No table rows found on the page. Verify access and page structure.');
    }

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ url, extractedAt: new Date().toISOString(), tables }, null, 2));
  } finally {
    await browser.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  try {
    if (args.login) {
      await runLoginFlow(args);
    } else {
      await scrapeWithSavedSession(args);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}

main();
