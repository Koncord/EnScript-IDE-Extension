/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/test/**/*.test.ts'],
    moduleFileExtensions: ['ts', 'js', 'json'],
    roots: ['<rootDir>/test', '<rootDir>/server'],
    transform: {
        '^.+\\.ts$': ['ts-jest', {
            tsconfig: 'tsconfig.test.json'
        }]
    },
    setupFilesAfterEnv: ['<rootDir>/test/test-setup.ts'],
    // Module path mapping
    moduleNameMapper: {
        '^@server/(.*)$': '<rootDir>/server/src/$1',
        '^@test/(.*)$': '<rootDir>/test/$1',
        '^@fixtures/(.*)$': '<rootDir>/test/fixtures/$1'
    },
    // Increase timeout for tests that might need cleanup
    testTimeout: 30000,
    // Force exit to prevent hanging
    forceExit: true,
    // Don't keep Jest open after test run
    detectOpenHandles: true
};