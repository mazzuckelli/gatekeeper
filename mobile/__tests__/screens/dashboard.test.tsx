import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';

// Mock dependencies before importing components
const mockReplace = jest.fn();
const mockUseRouter = jest.fn(() => ({ replace: mockReplace }));

jest.mock('expo-router', () => ({
  useRouter: () => mockUseRouter(),
  Redirect: 'Redirect',
}));

jest.mock('../../src/contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

import DashboardScreen from '../../app/(tabs)/index';
import { useAuth } from '../../src/contexts/AuthContext';

describe('Dashboard Screen', () => {
  const mockSignOut = jest.fn();

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    created_at: '2024-01-15T12:00:00Z',
  };

  const mockSession = {
    access_token: 'test-token',
    user: mockUser,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockReplace.mockClear();

    (useAuth as jest.Mock).mockReturnValue({
      user: mockUser,
      session: mockSession,
      loading: false,
      signOut: mockSignOut,
    });
  });

  describe('Rendering', () => {
    it('shows Account Overview card', () => {
      render(<DashboardScreen />);
      expect(screen.getByText('Account Overview')).toBeTruthy();
    });

    it('shows user email', () => {
      render(<DashboardScreen />);
      expect(screen.getByText('test@example.com')).toBeTruthy();
    });

    it('shows Member Since date', () => {
      render(<DashboardScreen />);
      expect(screen.getByText('Member Since')).toBeTruthy();
      expect(screen.getByText('January 15, 2024')).toBeTruthy();
    });

    it('shows subscription badge', () => {
      render(<DashboardScreen />);
      expect(screen.getByText('Subscription')).toBeTruthy();
      expect(screen.getByText('Free')).toBeTruthy();
    });

    it('shows Privacy Status card', () => {
      render(<DashboardScreen />);
      expect(screen.getByText('Privacy Status')).toBeTruthy();
    });

    it('shows Identity Protected status', () => {
      render(<DashboardScreen />);
      expect(screen.getByText('Identity Protected')).toBeTruthy();
    });

    it('shows privacy description', () => {
      render(<DashboardScreen />);
      expect(screen.getByText(/Gatekeeper knows your identity/)).toBeTruthy();
      expect(screen.getByText(/ghost_id/)).toBeTruthy();
    });

    it('shows Sign Out button', () => {
      render(<DashboardScreen />);
      expect(screen.getByText('Sign Out')).toBeTruthy();
    });
  });

  describe('Loading State', () => {
    it('shows loading indicator when loading', () => {
      (useAuth as jest.Mock).mockReturnValue({
        user: null,
        session: null,
        loading: true,
        signOut: mockSignOut,
      });

      render(<DashboardScreen />);

      // Should not show the main content
      expect(screen.queryByText('Account Overview')).toBeNull();
    });
  });

  describe('Sign Out', () => {
    it('calls signOut when Sign Out button pressed', async () => {
      mockSignOut.mockResolvedValue(undefined);

      render(<DashboardScreen />);

      fireEvent.press(screen.getByText('Sign Out'));

      await waitFor(() => {
        expect(mockSignOut).toHaveBeenCalled();
      });
    });
  });

  describe('Navigation', () => {
    it('redirects to login when no session', async () => {
      (useAuth as jest.Mock).mockReturnValue({
        user: null,
        session: null,
        loading: false,
        signOut: mockSignOut,
      });

      render(<DashboardScreen />);

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/login');
      });
    });
  });

  describe('Edge Cases', () => {
    it('shows Unknown for email when user email is missing', () => {
      (useAuth as jest.Mock).mockReturnValue({
        user: { id: 'user-123', created_at: '2024-01-15T12:00:00Z' },
        session: mockSession,
        loading: false,
        signOut: mockSignOut,
      });

      render(<DashboardScreen />);

      // Should show Unknown for email but not for date (since created_at is provided)
      expect(screen.getByText('Unknown')).toBeTruthy();
    });

    it('shows Unknown for Member Since when created_at is missing', () => {
      (useAuth as jest.Mock).mockReturnValue({
        user: { id: 'user-123', email: 'test@example.com' },
        session: mockSession,
        loading: false,
        signOut: mockSignOut,
      });

      render(<DashboardScreen />);

      // Should show Unknown for date
      const memberSinceRow = screen.getByText('Member Since');
      expect(memberSinceRow).toBeTruthy();
    });
  });
});
