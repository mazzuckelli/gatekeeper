import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

// Mock dependencies
jest.mock('../../src/contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../src/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      updateUser: jest.fn(),
    },
  },
}));

jest.mock('../../src/lib/passkey', () => ({
  registerPasskey: jest.fn(),
  clearStoredPasskey: jest.fn(),
  hasStoredPasskey: jest.fn(),
}));

// Mock fetch
global.fetch = jest.fn();

jest.spyOn(Alert, 'alert');

import SecurityScreen from '../../app/(tabs)/security';
import { useAuth } from '../../src/contexts/AuthContext';
import { supabase } from '../../src/lib/supabase';
import { registerPasskey, clearStoredPasskey, hasStoredPasskey } from '../../src/lib/passkey';

describe('Security Screen', () => {
  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
  };

  const mockSession = {
    access_token: 'test-token',
    user: mockUser,
  };

  const mockPasskeys = [
    {
      id: 'passkey-1',
      device_name: 'iPhone 15',
      created_at: '2024-01-15T12:00:00Z',
    },
    {
      id: 'passkey-2',
      device_name: 'Android Phone',
      created_at: '2024-01-20T12:00:00Z',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    (useAuth as jest.Mock).mockReturnValue({
      user: mockUser,
    });

    (supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: { session: mockSession },
    });

    (hasStoredPasskey as jest.Mock).mockResolvedValue(false);

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ passkeys: mockPasskeys }),
    });
  });

  describe('Rendering', () => {
    it('shows Hardware Security card', async () => {
      render(<SecurityScreen />);

      await waitFor(() => {
        expect(screen.getByText('Hardware Security')).toBeTruthy();
      });
    });

    it('shows description text', async () => {
      render(<SecurityScreen />);

      await waitFor(() => {
        expect(screen.getByText('Manage your physical device keys.')).toBeTruthy();
      });
    });

    it('shows Link This Device button', async () => {
      render(<SecurityScreen />);

      await waitFor(() => {
        expect(screen.getByText('Link This Device')).toBeTruthy();
      });
    });

    it('shows Change Password card', async () => {
      render(<SecurityScreen />);

      await waitFor(() => {
        expect(screen.getByText('Change Password')).toBeTruthy();
      });
    });

    it('shows password inputs', async () => {
      render(<SecurityScreen />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('New Password')).toBeTruthy();
        expect(screen.getByPlaceholderText('Confirm')).toBeTruthy();
      });
    });

    it('shows Update Password button', async () => {
      render(<SecurityScreen />);

      await waitFor(() => {
        expect(screen.getByText('Update Password')).toBeTruthy();
      });
    });
  });

  describe('Passkey List', () => {
    it('shows registered passkeys', async () => {
      render(<SecurityScreen />);

      await waitFor(() => {
        expect(screen.getByText('iPhone 15')).toBeTruthy();
        expect(screen.getByText('Android Phone')).toBeTruthy();
      });
    });

    it('shows passkey registration dates', async () => {
      render(<SecurityScreen />);

      await waitFor(() => {
        expect(screen.getByText('1/15/2024')).toBeTruthy();
        expect(screen.getByText('1/20/2024')).toBeTruthy();
      });
    });

    it('shows Delete button for each passkey', async () => {
      render(<SecurityScreen />);

      await waitFor(() => {
        const deleteButtons = screen.getAllByText('Delete');
        expect(deleteButtons.length).toBe(2);
      });
    });

    it('shows empty message when no passkeys', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ passkeys: [] }),
      });

      render(<SecurityScreen />);

      await waitFor(() => {
        expect(screen.getByText('No devices linked yet.')).toBeTruthy();
      });
    });
  });

  describe('Link Device', () => {
    it('calls registerPasskey when Link This Device pressed', async () => {
      (registerPasskey as jest.Mock).mockResolvedValue({ success: true });

      render(<SecurityScreen />);

      await waitFor(() => {
        expect(screen.getByText('Link This Device')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Link This Device'));

      await waitFor(() => {
        expect(registerPasskey).toHaveBeenCalledWith('test@example.com');
      });
    });

    it('shows success alert on successful registration', async () => {
      (registerPasskey as jest.Mock).mockResolvedValue({ success: true });

      render(<SecurityScreen />);

      await waitFor(() => {
        expect(screen.getByText('Link This Device')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Link This Device'));

      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith('Success', 'Device linked.');
      });
    });

    it('shows error alert on failed registration', async () => {
      (registerPasskey as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Device not supported',
      });

      render(<SecurityScreen />);

      await waitFor(() => {
        expect(screen.getByText('Link This Device')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Link This Device'));

      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith('Registration Error', 'Device not supported');
      });
    });
  });

  describe('Clear Stored Passkey', () => {
    beforeEach(() => {
      (hasStoredPasskey as jest.Mock).mockResolvedValue(true);
    });

    it('shows Clear Stored Passkey button when passkey exists locally', async () => {
      render(<SecurityScreen />);

      await waitFor(() => {
        expect(screen.getByText('Clear Stored Passkey')).toBeTruthy();
      });
    });

    it('hides Clear Stored Passkey button when no local passkey', async () => {
      (hasStoredPasskey as jest.Mock).mockResolvedValue(false);

      render(<SecurityScreen />);

      await waitFor(() => {
        expect(screen.getByText('Link This Device')).toBeTruthy();
      });

      expect(screen.queryByText('Clear Stored Passkey')).toBeNull();
    });

    it('shows confirmation dialog when Clear Stored Passkey pressed', async () => {
      render(<SecurityScreen />);

      await waitFor(() => {
        expect(screen.getByText('Clear Stored Passkey')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Clear Stored Passkey'));

      expect(Alert.alert).toHaveBeenCalledWith(
        'Clear Passkey',
        expect.stringContaining('remove the passkey from this device'),
        expect.any(Array)
      );
    });
  });

  describe('Delete Passkey', () => {
    it('shows confirmation dialog when Delete pressed', async () => {
      render(<SecurityScreen />);

      await waitFor(() => {
        expect(screen.getByText('iPhone 15')).toBeTruthy();
      });

      const deleteButtons = screen.getAllByText('Delete');
      fireEvent.press(deleteButtons[0]);

      expect(Alert.alert).toHaveBeenCalledWith(
        'Delete Passkey',
        'Remove "iPhone 15" from your account?',
        expect.any(Array)
      );
    });
  });

  describe('Load Passkeys Edge Cases', () => {
    it('handles no active session', async () => {
      (supabase.auth.getSession as jest.Mock).mockResolvedValue({
        data: { session: null },
      });

      // Suppress console.warn for this test
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      render(<SecurityScreen />);

      await waitFor(() => {
        expect(screen.getByText('No devices linked yet.')).toBeTruthy();
      });

      expect(consoleSpy).toHaveBeenCalledWith('[Security] No active session');
      consoleSpy.mockRestore();
    });

    it('handles fetch error response', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Server error' }),
      });

      // Suppress console.warn for this test
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      render(<SecurityScreen />);

      await waitFor(() => {
        expect(screen.getByText('No devices linked yet.')).toBeTruthy();
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        '[Security] Function returned error:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('handles fetch exception', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      // Suppress console.error for this test
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      render(<SecurityScreen />);

      await waitFor(() => {
        expect(screen.getByText('No devices linked yet.')).toBeTruthy();
      });

      expect(consoleSpy).toHaveBeenCalledWith('[Security] Fetch Exception:', 'Network error');
      consoleSpy.mockRestore();
    });
  });

  describe('Link Device Edge Cases', () => {
    it('shows hardware error when registerPasskey throws', async () => {
      (registerPasskey as jest.Mock).mockRejectedValue(new Error('Hardware failure'));

      render(<SecurityScreen />);

      await waitFor(() => {
        expect(screen.getByText('Link This Device')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Link This Device'));

      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith('Error', 'Hardware communication failed.');
      });
    });
  });

  describe('Clear Passkey Confirmation', () => {
    beforeEach(() => {
      (hasStoredPasskey as jest.Mock).mockResolvedValue(true);
    });

    it('clears passkey when confirmed', async () => {
      (clearStoredPasskey as jest.Mock).mockResolvedValue(undefined);

      // Mock Alert.alert to call the onPress handler
      (Alert.alert as jest.Mock).mockImplementation((title, message, buttons) => {
        // Find the "Clear" button and call its onPress
        const clearButton = buttons?.find((b: any) => b.text === 'Clear');
        if (clearButton?.onPress) {
          clearButton.onPress();
        }
      });

      render(<SecurityScreen />);

      await waitFor(() => {
        expect(screen.getByText('Clear Stored Passkey')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Clear Stored Passkey'));

      await waitFor(() => {
        expect(clearStoredPasskey).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith('Success', 'Passkey cleared from device.');
      });
    });

    it('shows error when clear fails', async () => {
      (clearStoredPasskey as jest.Mock).mockRejectedValue(new Error('Storage error'));

      // Mock Alert.alert to call the onPress handler
      (Alert.alert as jest.Mock).mockImplementation((title, message, buttons) => {
        const clearButton = buttons?.find((b: any) => b.text === 'Clear');
        if (clearButton?.onPress) {
          clearButton.onPress();
        }
      });

      render(<SecurityScreen />);

      await waitFor(() => {
        expect(screen.getByText('Clear Stored Passkey')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Clear Stored Passkey'));

      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith('Error', 'Storage error');
      });
    });
  });

  describe('Delete Passkey from Server', () => {
    it('deletes passkey when confirmed', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ passkeys: mockPasskeys }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ passkeys: [] }),
        });

      // Mock Alert.alert to call the onPress handler
      (Alert.alert as jest.Mock).mockImplementation((title, message, buttons) => {
        const deleteButton = buttons?.find((b: any) => b.text === 'Delete');
        if (deleteButton?.onPress) {
          deleteButton.onPress();
        }
      });

      render(<SecurityScreen />);

      await waitFor(() => {
        expect(screen.getByText('iPhone 15')).toBeTruthy();
      });

      const deleteButtons = screen.getAllByText('Delete');
      fireEvent.press(deleteButtons[0]);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('passkey-register'),
          expect.objectContaining({
            method: 'DELETE',
            body: JSON.stringify({ passkey_id: 'passkey-1' }),
          })
        );
      });
    });

    it('shows success alert after deletion', async () => {
      let alertCalls = 0;

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ passkeys: mockPasskeys }),
        })
        .mockResolvedValueOnce({
          ok: true,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ passkeys: [] }),
        });

      (Alert.alert as jest.Mock).mockImplementation((title, message, buttons) => {
        alertCalls++;
        if (alertCalls === 1 && buttons) {
          const deleteButton = buttons.find((b: any) => b.text === 'Delete');
          if (deleteButton?.onPress) {
            deleteButton.onPress();
          }
        }
      });

      render(<SecurityScreen />);

      await waitFor(() => {
        expect(screen.getByText('iPhone 15')).toBeTruthy();
      });

      const deleteButtons = screen.getAllByText('Delete');
      fireEvent.press(deleteButtons[0]);

      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith('Success', 'Passkey deleted.');
      });
    });

    it('shows error when delete fails', async () => {
      let alertCalls = 0;

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ passkeys: mockPasskeys }),
        })
        .mockResolvedValueOnce({
          ok: false,
          text: () => Promise.resolve('Server error'),
        });

      (Alert.alert as jest.Mock).mockImplementation((title, message, buttons) => {
        alertCalls++;
        if (alertCalls === 1 && buttons) {
          const deleteButton = buttons.find((b: any) => b.text === 'Delete');
          if (deleteButton?.onPress) {
            deleteButton.onPress();
          }
        }
      });

      render(<SecurityScreen />);

      await waitFor(() => {
        expect(screen.getByText('iPhone 15')).toBeTruthy();
      });

      const deleteButtons = screen.getAllByText('Delete');
      fireEvent.press(deleteButtons[0]);

      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith('Error', 'Server error');
      });
    });

    it('shows error when no session for delete', async () => {
      let alertCalls = 0;

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ passkeys: mockPasskeys }),
      });

      // Return no session for delete operation
      (supabase.auth.getSession as jest.Mock)
        .mockResolvedValueOnce({ data: { session: mockSession } })
        .mockResolvedValueOnce({ data: { session: null } });

      (Alert.alert as jest.Mock).mockImplementation((title, message, buttons) => {
        alertCalls++;
        if (alertCalls === 1 && buttons) {
          const deleteButton = buttons.find((b: any) => b.text === 'Delete');
          if (deleteButton?.onPress) {
            deleteButton.onPress();
          }
        }
      });

      render(<SecurityScreen />);

      await waitFor(() => {
        expect(screen.getByText('iPhone 15')).toBeTruthy();
      });

      const deleteButtons = screen.getAllByText('Delete');
      fireEvent.press(deleteButtons[0]);

      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith('Error', 'No active session');
      });
    });
  });

  describe('Change Password', () => {
    it('shows error when passwords do not match', async () => {
      render(<SecurityScreen />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('New Password')).toBeTruthy();
      });

      fireEvent.changeText(screen.getByPlaceholderText('New Password'), 'newpassword123');
      fireEvent.changeText(screen.getByPlaceholderText('Confirm'), 'differentpassword');
      fireEvent.press(screen.getByText('Update Password'));

      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith('Error', 'Passwords mismatch');
      });
    });

    it('calls supabase updateUser when passwords match', async () => {
      (supabase.auth.updateUser as jest.Mock).mockResolvedValue({ error: null });

      render(<SecurityScreen />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('New Password')).toBeTruthy();
      });

      fireEvent.changeText(screen.getByPlaceholderText('New Password'), 'newpassword123');
      fireEvent.changeText(screen.getByPlaceholderText('Confirm'), 'newpassword123');
      fireEvent.press(screen.getByText('Update Password'));

      await waitFor(() => {
        expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'newpassword123' });
      });
    });

    it('shows success alert on successful password change', async () => {
      (supabase.auth.updateUser as jest.Mock).mockResolvedValue({ error: null });

      render(<SecurityScreen />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('New Password')).toBeTruthy();
      });

      fireEvent.changeText(screen.getByPlaceholderText('New Password'), 'newpassword123');
      fireEvent.changeText(screen.getByPlaceholderText('Confirm'), 'newpassword123');
      fireEvent.press(screen.getByText('Update Password'));

      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith('Success', 'Password updated');
      });
    });

    it('shows error alert on failed password change', async () => {
      (supabase.auth.updateUser as jest.Mock).mockResolvedValue({
        error: { message: 'Password too weak' },
      });

      render(<SecurityScreen />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('New Password')).toBeTruthy();
      });

      fireEvent.changeText(screen.getByPlaceholderText('New Password'), 'weak');
      fireEvent.changeText(screen.getByPlaceholderText('Confirm'), 'weak');
      fireEvent.press(screen.getByText('Update Password'));

      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith('Error', 'Password too weak');
      });
    });

    it('clears password fields on successful update', async () => {
      (supabase.auth.updateUser as jest.Mock).mockResolvedValue({ error: null });

      render(<SecurityScreen />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('New Password')).toBeTruthy();
      });

      fireEvent.changeText(screen.getByPlaceholderText('New Password'), 'newpassword123');
      fireEvent.changeText(screen.getByPlaceholderText('Confirm'), 'newpassword123');
      fireEvent.press(screen.getByText('Update Password'));

      await waitFor(() => {
        expect(screen.getByPlaceholderText('New Password').props.value).toBe('');
        expect(screen.getByPlaceholderText('Confirm').props.value).toBe('');
      });
    });
  });
});
