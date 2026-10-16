import { defineConfig } from 'vitest/config';
import 'dotenv/config';
if (
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
)
  throw new Error('Set TEST_DATABASE_URL to a separate database whose name ends in _test.');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
export default defineConfig({
  test: { include: ['tests/*.integration.test.ts'], environment: 'node', fileParallelism: false },
});
