/** Plain ts-jest. Nothing under test renders; HTTP is mocked and storage is
 *  the in-memory platform adapter (or the browser adapter over
 *  fake-indexeddb when KOOLBASE_TEST_PLATFORM=browser). */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }] },
};
