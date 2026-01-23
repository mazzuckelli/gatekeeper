import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

// Mock dependencies
jest.mock('../../src/contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn(),
        })),
      })),
      upsert: jest.fn(),
    })),
  },
}));

jest.spyOn(Alert, 'alert');

import ProfileScreen from '../../app/(tabs)/profile';
import { useAuth } from '../../src/contexts/AuthContext';
import { supabase } from '../../src/lib/supabase';

describe('Profile Screen', () => {
  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
  };

  const mockProfile = {
    display_name: 'Test User',
    timezone: 'America/New_York',
    subscription_tier: 'free',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    (useAuth as jest.Mock).mockReturnValue({
      user: mockUser,
    });

    // Setup default supabase mock chain
    const mockSingle = jest.fn().mockResolvedValue({
      data: mockProfile,
      error: null,
    });
    const mockEq = jest.fn().mockReturnValue({ single: mockSingle });
    const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
    const mockUpsert = jest.fn().mockResolvedValue({ error: null });

    (supabase.from as jest.Mock).mockReturnValue({
      select: mockSelect,
      upsert: mockUpsert,
    });
  });

  describe('Rendering', () => {
    it('shows Profile Information card', async () => {
      render(<ProfileScreen />);

      await waitFor(() => {
        expect(screen.getByText('Profile Information')).toBeTruthy();
      });
    });

    it('shows user email', async () => {
      render(<ProfileScreen />);

      await waitFor(() => {
        expect(screen.getByText('test@example.com')).toBeTruthy();
      });
    });

    it('shows email cannot be changed hint', async () => {
      render(<ProfileScreen />);

      await waitFor(() => {
        expect(screen.getByText('Email cannot be changed')).toBeTruthy();
      });
    });

    it('shows Display Name input', async () => {
      render(<ProfileScreen />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Enter display name')).toBeTruthy();
      });
    });

    it('shows Save Changes button', async () => {
      render(<ProfileScreen />);

      await waitFor(() => {
        expect(screen.getByText('Save Changes')).toBeTruthy();
      });
    });

    it('shows Subscription card', async () => {
      render(<ProfileScreen />);

      await waitFor(() => {
        expect(screen.getByText('Subscription')).toBeTruthy();
      });
    });

    it('shows subscription tier', async () => {
      render(<ProfileScreen />);

      await waitFor(() => {
        expect(screen.getByText('free')).toBeTruthy();
      });
    });

    it('shows tier description for free tier', async () => {
      render(<ProfileScreen />);

      await waitFor(() => {
        expect(screen.getByText('Basic access to all features')).toBeTruthy();
      });
    });
  });

  describe('Loading State', () => {
    it('shows loading indicator while fetching profile', async () => {
      // Make the fetch hang
      const mockSingle = jest.fn().mockImplementation(() => new Promise(() => {}));
      const mockEq = jest.fn().mockReturnValue({ single: mockSingle });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });

      (supabase.from as jest.Mock).mockReturnValue({
        select: mockSelect,
        upsert: jest.fn(),
      });

      render(<ProfileScreen />);

      // Should not show profile content yet
      expect(screen.queryByText('Profile Information')).toBeNull();
    });
  });

  describe('Form Interaction', () => {
    it('populates display name from loaded profile', async () => {
      render(<ProfileScreen />);

      await waitFor(() => {
        const input = screen.getByPlaceholderText('Enter display name');
        expect(input.props.value).toBe('Test User');
      });
    });

    it('allows editing display name', async () => {
      render(<ProfileScreen />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Enter display name')).toBeTruthy();
      });

      fireEvent.changeText(
        screen.getByPlaceholderText('Enter display name'),
        'New Name'
      );

      expect(screen.getByPlaceholderText('Enter display name').props.value).toBe('New Name');
    });
  });

  describe('Save Profile', () => {
    it('calls supabase upsert when Save Changes pressed', async () => {
      const mockUpsert = jest.fn().mockResolvedValue({ error: null });
      const mockSingle = jest.fn().mockResolvedValue({
        data: mockProfile,
        error: null,
      });
      const mockEq = jest.fn().mockReturnValue({ single: mockSingle });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });

      (supabase.from as jest.Mock).mockReturnValue({
        select: mockSelect,
        upsert: mockUpsert,
      });

      render(<ProfileScreen />);

      await waitFor(() => {
        expect(screen.getByText('Save Changes')).toBeTruthy();
      });

      fireEvent.changeText(
        screen.getByPlaceholderText('Enter display name'),
        'Updated Name'
      );

      fireEvent.press(screen.getByText('Save Changes'));

      await waitFor(() => {
        expect(mockUpsert).toHaveBeenCalled();
      });
    });

    it('shows success alert on successful save', async () => {
      const mockUpsert = jest.fn().mockResolvedValue({ error: null });
      const mockSingle = jest.fn().mockResolvedValue({
        data: mockProfile,
        error: null,
      });
      const mockEq = jest.fn().mockReturnValue({ single: mockSingle });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });

      (supabase.from as jest.Mock).mockReturnValue({
        select: mockSelect,
        upsert: mockUpsert,
      });

      render(<ProfileScreen />);

      await waitFor(() => {
        expect(screen.getByText('Save Changes')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Save Changes'));

      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith('Success', 'Profile updated successfully');
      });
    });

    it('shows error alert on failed save', async () => {
      const mockUpsert = jest.fn().mockResolvedValue({
        error: { message: 'Database error' },
      });
      const mockSingle = jest.fn().mockResolvedValue({
        data: mockProfile,
        error: null,
      });
      const mockEq = jest.fn().mockReturnValue({ single: mockSingle });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });

      (supabase.from as jest.Mock).mockReturnValue({
        select: mockSelect,
        upsert: mockUpsert,
      });

      render(<ProfileScreen />);

      await waitFor(() => {
        expect(screen.getByText('Save Changes')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Save Changes'));

      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith('Error', 'Database error');
      });
    });
  });

  describe('Edge Cases', () => {
    it('handles missing profile gracefully', async () => {
      const mockSingle = jest.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      });
      const mockEq = jest.fn().mockReturnValue({ single: mockSingle });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });

      (supabase.from as jest.Mock).mockReturnValue({
        select: mockSelect,
        upsert: jest.fn(),
      });

      render(<ProfileScreen />);

      await waitFor(() => {
        expect(screen.getByText('Profile Information')).toBeTruthy();
      });

      // Should show empty display name input
      expect(screen.getByPlaceholderText('Enter display name').props.value).toBe('');
    });

    it('shows Unknown when user email is missing', async () => {
      (useAuth as jest.Mock).mockReturnValue({
        user: { id: 'user-123' },
      });

      render(<ProfileScreen />);

      await waitFor(() => {
        expect(screen.getByText('Unknown')).toBeTruthy();
      });
    });

    it('logs error when database query fails with non-PGRST116 error', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const mockSingle = jest.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST500', message: 'Database connection failed' },
      });
      const mockEq = jest.fn().mockReturnValue({ single: mockSingle });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });

      (supabase.from as jest.Mock).mockReturnValue({
        select: mockSelect,
        upsert: jest.fn(),
      });

      render(<ProfileScreen />);

      await waitFor(() => {
        expect(screen.getByText('Profile Information')).toBeTruthy();
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to load profile:',
        'Database connection failed'
      );

      consoleSpy.mockRestore();
    });

  });
});
