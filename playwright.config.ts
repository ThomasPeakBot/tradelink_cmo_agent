import { defineConfig } from '@playwright/test';
import 'dotenv/config';
if (
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
)
  throw new Error('Set TEST_DATABASE_URL to a separate PostgreSQL database ending in _test.');
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL: 'http://localhost:3001',
    headless: true,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  webServer: {
    command: 'npm run dev -- --port 3001',
    url: 'http://localhost:3001/api/health',
    timeout: 120000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      APP_URL: 'http://localhost:3001',
      NEXT_DIST_DIR: '.next-e2e',
      OPENAI_API_KEY: '',
      TRADELINK_OPENAI_API_KEY: '',
    },
  },
});
