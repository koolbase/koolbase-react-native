/**
 * Plain ts-jest, no React Native preset.
 *
 * Nothing under test renders — this package makes HTTP calls and reads a
 * key-value store, both of which are mocked. Pulling in the RN preset would add
 * a native runtime, a transform chain, and a class of setup failure with no
 * corresponding coverage.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  moduleNameMapper: {
    // AsyncStorage is a native module with no Node implementation. The manual
    // mock is an in-memory map, which is what the cache store treats it as.
    '^@react-native-async-storage/async-storage$':
      '<rootDir>/test/mocks/async-storage.ts',
    '^@react-native-community/netinfo$': '<rootDir>/test/mocks/netinfo.ts',
  },
};
