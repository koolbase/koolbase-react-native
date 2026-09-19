/** Plain ts-jest. Nothing under test renders; HTTP is mocked and storage is
 *  the in-memory platform adapter (or the browser adapter over
 *  fake-indexeddb when KOOLBASE_TEST_PLATFORM=browser). */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  // Sources carry .js extensions on relative imports because Node's ESM
  // loader requires them. TypeScript maps ./x.js to ./x.ts; jest does not,
  // so it is told the same rule here.
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }] },
};
