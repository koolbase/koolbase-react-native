import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { AppState, AppStateStatus, Platform } from 'react-native';
import type { PlatformAdapter } from '@koolbase/core';
import { SecureAuthStorage, isKeychainAvailable } from './auth-storage.js';

// The React Native host, expressed through the platform seam. This is the
// only file in the package that imports a native module; everything the SDK
// does with storage, connectivity, lifecycle or platform identity goes
// through the adapter it returns.

export function reactNativePlatform(): PlatformAdapter {
  return {
    storage: {
      getItem: (k) => AsyncStorage.getItem(k),
      setItem: (k, v) => AsyncStorage.setItem(k, v),
      removeItem: (k) => AsyncStorage.removeItem(k),
      getAllKeys: async () => Array.from(await AsyncStorage.getAllKeys()),
    },
    network: {
      onChange: (cb) =>
        NetInfo.addEventListener(state => {
          cb(Boolean(state.isConnected) && state.isInternetReachable !== false);
        }),
    },
    lifecycle: {
      onBackground: (cb) => {
        const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
          if (state === 'background' || state === 'inactive') cb();
        });
        return () => sub.remove();
      },
    },
    info: {
      os: String(Platform.OS),
      version: String(Platform.Version),
    },
    authStorage: () => (isKeychainAvailable() ? new SecureAuthStorage() : null),
  };
}
