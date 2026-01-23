import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

// Mock dependencies before importing
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
}));

jest.mock('../../src/contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

import Index from '../../app/index';
import { useAuth } from '../../src/contexts/AuthContext';

describe('Index (Root Route)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Loading state', () => {
    it('shows loading indicator while checking auth', () => {
      (useAuth as jest.Mock).mockReturnValue({
        session: null,
        loading: true,
      });

      const { toJSON } = render(<Index />);

      // Should render ActivityIndicator
      const tree = toJSON();
      expect(tree).not.toBeNull();
    });

    it('does not navigate while loading', () => {
      (useAuth as jest.Mock).mockReturnValue({
        session: null,
        loading: true,
      });

      render(<Index />);

      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  describe('Authenticated user', () => {
    it('redirects to tabs when session exists', async () => {
      (useAuth as jest.Mock).mockReturnValue({
        session: { access_token: 'token' },
        loading: false,
      });

      render(<Index />);

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
      });
    });

    it('redirects to tabs only once', async () => {
      (useAuth as jest.Mock).mockReturnValue({
        session: { access_token: 'token' },
        loading: false,
      });

      render(<Index />);

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Unauthenticated user', () => {
    it('redirects to login when no session', async () => {
      (useAuth as jest.Mock).mockReturnValue({
        session: null,
        loading: false,
      });

      render(<Index />);

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/login');
      });
    });

    it('redirects to login only once', async () => {
      (useAuth as jest.Mock).mockReturnValue({
        session: null,
        loading: false,
      });

      render(<Index />);

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('State transitions', () => {
    it('waits for loading to complete before redirecting', async () => {
      // Start loading
      (useAuth as jest.Mock).mockReturnValue({
        session: null,
        loading: true,
      });

      const { rerender } = render(<Index />);

      // Should not redirect yet
      expect(mockReplace).not.toHaveBeenCalled();

      // Finish loading with session
      (useAuth as jest.Mock).mockReturnValue({
        session: { access_token: 'token' },
        loading: false,
      });

      rerender(<Index />);

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
      });
    });
  });
});
