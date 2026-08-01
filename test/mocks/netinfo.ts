/** Reports connected; tests that care about connectivity set it explicitly. */
export default {
  fetch: async () => ({ isConnected: true, isInternetReachable: true }),
  addEventListener: () => () => {},
};
