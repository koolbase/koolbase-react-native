/** In-memory AsyncStorage, which is what the cache store treats it as anyway. */
const store = new Map<string, string>();

export default {
  getItem: async (k: string) => store.get(k) ?? null,
  setItem: async (k: string, v: string) => void store.set(k, v),
  removeItem: async (k: string) => void store.delete(k),
  getAllKeys: async () => Array.from(store.keys()),
  multiRemove: async (ks: string[]) => ks.forEach((k) => store.delete(k)),
  clear: async () => store.clear(),
  __reset: () => store.clear(),
};
