import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { View, Text } from 'react-native';

// Mock dependencies before importing
const mockReplace = jest.fn();

jest.mock('expo-router', () => {
  const React = require('react');
  const { View } = require('react-native');

  // Create mock Tabs component with Screen property
  const MockTabs = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(View, { testID: 'mock-tabs' }, children);
  MockTabs.Screen = ({ name }: { name: string }) =>
    React.createElement(View, { testID: `tab-screen-${name}` });

  return {
    useRouter: () => ({
      replace: mockReplace,
    }),
    Tabs: MockTabs,
  };
});

jest.mock('../../src/contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

import TabsLayout from '../../app/(tabs)/_layout';
import { useAuth } from '../../src/contexts/AuthContext';

describe('Tabs Layout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Authenticated state', () => {
    it('renders tabs when session exists', () => {
      (useAuth as jest.Mock).mockReturnValue({
        session: { access_token: 'token' },
        loading: false,
      });

      const { toJSON } = render(<TabsLayout />);

      // Should render without redirecting
      expect(mockReplace).not.toHaveBeenCalled();
      expect(toJSON()).not.toBeNull();
    });

    it('does not redirect when authenticated', async () => {
      (useAuth as jest.Mock).mockReturnValue({
        session: { access_token: 'token' },
        loading: false,
      });

      render(<TabsLayout />);

      // Wait a tick to ensure no redirect
      await waitFor(() => {
        expect(mockReplace).not.toHaveBeenCalled();
      });
    });
  });

  describe('Unauthenticated state', () => {
    it('redirects to login when no session', async () => {
      (useAuth as jest.Mock).mockReturnValue({
        session: null,
        loading: false,
      });

      render(<TabsLayout />);

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/login');
      });
    });

    it('redirects to login only once', async () => {
      (useAuth as jest.Mock).mockReturnValue({
        session: null,
        loading: false,
      });

      render(<TabsLayout />);

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Loading state', () => {
    it('does not redirect while loading', () => {
      (useAuth as jest.Mock).mockReturnValue({
        session: null,
        loading: true,
      });

      render(<TabsLayout />);

      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('waits for loading to complete before redirecting', async () => {
      // Start loading
      (useAuth as jest.Mock).mockReturnValue({
        session: null,
        loading: true,
      });

      const { rerender } = render(<TabsLayout />);

      // Should not redirect while loading
      expect(mockReplace).not.toHaveBeenCalled();

      // Finish loading without session
      (useAuth as jest.Mock).mockReturnValue({
        session: null,
        loading: false,
      });

      rerender(<TabsLayout />);

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/login');
      });
    });
  });

  describe('Session changes', () => {
    it('redirects when session is lost', async () => {
      // Start with session
      (useAuth as jest.Mock).mockReturnValue({
        session: { access_token: 'token' },
        loading: false,
      });

      const { rerender } = render(<TabsLayout />);

      // Session lost
      (useAuth as jest.Mock).mockReturnValue({
        session: null,
        loading: false,
      });

      rerender(<TabsLayout />);

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/login');
      });
    });
  });
});
