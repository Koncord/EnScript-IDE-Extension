/**
 * Jest test setup file
 * This file runs after the test environment is set up but before tests are run.
 * 
 * Add global test configurations, mocks, or setup logic here as needed.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

// Global test configuration
jest.setTimeout(30000);

// Load SDK base file for tests that need it
const sdkBasePath = join(__dirname, 'fixtures', 'sdk_base.c');
const sdkBaseContent = readFileSync(sdkBasePath, 'utf-8');

// Make SDK base content available globally for tests
(global as any).SDK_BASE_CONTENT = sdkBaseContent;
(global as any).SDK_BASE_URI = 'test://sdk_base.c';

// Global test setup
beforeAll(() => {
  // Setup code that runs before all test suites
  //console.log('Test setup: SDK base file loaded from fixtures');
});

// Global test teardown
afterAll(() => {
  // Cleanup code that runs after all test suites
});
