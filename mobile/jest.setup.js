// Set environment variables for tests
process.env.EXPO_PUBLIC_GATEKEEPER_URL = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_GATEKEEPER_PUBLISHABLE_KEY = 'test-key';

// Mock expo module to avoid winter runtime issues
jest.mock('expo', () => ({}));

// Mock expo-secure-store
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));

// Mock expo-local-authentication
jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn().mockResolvedValue(true),
  isEnrolledAsync: jest.fn().mockResolvedValue(true),
  authenticateAsync: jest.fn().mockResolvedValue({ success: true }),
  SecurityLevel: {
    NONE: 0,
    SECRET: 1,
    BIOMETRIC: 2,
  },
}));

// Mock react-native-passkey
jest.mock('react-native-passkey', () => ({
  Passkey: {
    isSupported: jest.fn().mockResolvedValue(true),
    create: jest.fn(),
    get: jest.fn(),
  },
}));

// Mock expo-linking
jest.mock('expo-linking', () => ({
  parse: jest.fn((url) => {
    try {
      const urlObj = new URL(url);
      const queryParams = {};
      urlObj.searchParams.forEach((value, key) => {
        queryParams[key] = value;
      });
      return {
        path: urlObj.pathname,
        queryParams,
      };
    } catch {
      return { path: null, queryParams: {} };
    }
  }),
  canOpenURL: jest.fn().mockResolvedValue(true),
  openURL: jest.fn().mockResolvedValue(undefined),
  createURL: jest.fn((path) => `gatekeeper://${path}`),
}));

// Mock expo-router - use jest.fn() for all to allow mockReturnValue in tests
const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
};
const mockUseRouter = jest.fn(() => mockRouter);
const mockUseLocalSearchParams = jest.fn(() => ({}));
const mockUseSegments = jest.fn(() => []);

jest.mock('expo-router', () => ({
  useRouter: mockUseRouter,
  useLocalSearchParams: mockUseLocalSearchParams,
  useSegments: mockUseSegments,
  Link: 'Link',
  Redirect: 'Redirect',
}));

// Export mocks for test files to access
global.__mocks__ = {
  expoRouter: {
    useRouter: mockUseRouter,
    router: mockRouter,
    useLocalSearchParams: mockUseLocalSearchParams,
    useSegments: mockUseSegments,
  },
};

// Mock @react-native-async-storage/async-storage
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Mock @react-native-community/netinfo
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => jest.fn()),
  fetch: jest.fn().mockResolvedValue({
    isConnected: true,
    isInternetReachable: true,
  }),
}));

// Mock global fetch for API calls
global.fetch = jest.fn();

// Reset fetch mock before each test
beforeEach(() => {
  (global.fetch).mockReset();
});
