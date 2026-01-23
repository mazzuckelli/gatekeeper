import React from 'react';
import { render, waitFor, act } from '@testing-library/react-native';
import { Text } from 'react-native';

// Store listener callback so tests can trigger state changes
let listenerCallback: Function | null = null;
const mockUnsubscribe = jest.fn();

// Mock NetInfo before importing component
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn((callback) => {
    listenerCallback = callback;
    return mockUnsubscribe;
  }),
  fetch: jest.fn().mockResolvedValue({
    isConnected: true,
    isInternetReachable: true,
  }),
}));

import { NetworkStatusBanner, useNetworkStatus } from '../../src/components/NetworkStatus';

describe('NetworkStatusBanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    listenerCallback = null;
    mockUnsubscribe.mockClear();
  });

  describe('Connected state', () => {
    it('returns null when initially mounted (connected by default)', () => {
      const { toJSON } = render(<NetworkStatusBanner />);
      // Initial state is isConnected = true, so component returns null
      expect(toJSON()).toBeNull();
    });

    it('returns null after receiving connected state', async () => {
      const { toJSON } = render(<NetworkStatusBanner />);

      // Simulate connected state
      if (listenerCallback) {
        act(() => {
          listenerCallback({ isConnected: true });
        });
      }

      await waitFor(() => {
        expect(toJSON()).toBeNull();
      });
    });
  });

  describe('Disconnected state', () => {
    it('shows banner when disconnected', async () => {
      const { getByText } = render(<NetworkStatusBanner />);

      // Simulate disconnected state
      if (listenerCallback) {
        act(() => {
          listenerCallback({ isConnected: false });
        });
      }

      await waitFor(() => {
        expect(getByText('No internet connection')).toBeTruthy();
      });
    });
  });

  describe('State transitions', () => {
    it('hides banner when connection is restored', async () => {
      const { getByText, queryByText } = render(<NetworkStatusBanner />);

      // Go offline
      if (listenerCallback) {
        act(() => {
          listenerCallback({ isConnected: false });
        });
      }

      await waitFor(() => {
        expect(getByText('No internet connection')).toBeTruthy();
      });

      // Go online
      if (listenerCallback) {
        act(() => {
          listenerCallback({ isConnected: true });
        });
      }

      await waitFor(() => {
        expect(queryByText('No internet connection')).toBeNull();
      });
    });
  });

  describe('Event listener', () => {
    it('registers listener on mount', () => {
      const NetInfo = require('@react-native-community/netinfo');

      render(<NetworkStatusBanner />);

      expect(NetInfo.addEventListener).toHaveBeenCalledWith(expect.any(Function));
    });

    it('unsubscribes on unmount', () => {
      const { unmount } = render(<NetworkStatusBanner />);
      unmount();

      expect(mockUnsubscribe).toHaveBeenCalled();
    });
  });
});

describe('useNetworkStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    listenerCallback = null;
    mockUnsubscribe.mockClear();
  });

  // Test component that uses the hook
  function TestComponent() {
    const { isConnected, isInternetReachable } = useNetworkStatus();
    return (
      <>
        <Text testID="connected">{isConnected === null ? 'null' : isConnected ? 'true' : 'false'}</Text>
        <Text testID="reachable">{isInternetReachable === null ? 'null' : isInternetReachable ? 'true' : 'false'}</Text>
      </>
    );
  }

  it('returns initial connected state as true', () => {
    const { getByTestId } = render(<TestComponent />);

    expect(getByTestId('connected').props.children).toBe('true');
    expect(getByTestId('reachable').props.children).toBe('true');
  });

  it('updates isConnected when network state changes', async () => {
    const { getByTestId } = render(<TestComponent />);

    if (listenerCallback) {
      act(() => {
        listenerCallback({ isConnected: false, isInternetReachable: false });
      });
    }

    await waitFor(() => {
      expect(getByTestId('connected').props.children).toBe('false');
    });
  });

  it('updates isInternetReachable when network state changes', async () => {
    const { getByTestId } = render(<TestComponent />);

    if (listenerCallback) {
      act(() => {
        listenerCallback({ isConnected: true, isInternetReachable: false });
      });
    }

    await waitFor(() => {
      expect(getByTestId('connected').props.children).toBe('true');
      expect(getByTestId('reachable').props.children).toBe('false');
    });
  });

  it('handles null connection state', async () => {
    const { getByTestId } = render(<TestComponent />);

    if (listenerCallback) {
      act(() => {
        listenerCallback({ isConnected: null, isInternetReachable: null });
      });
    }

    await waitFor(() => {
      expect(getByTestId('connected').props.children).toBe('null');
      expect(getByTestId('reachable').props.children).toBe('null');
    });
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<TestComponent />);
    unmount();

    expect(mockUnsubscribe).toHaveBeenCalled();
  });
});
