import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

// Mock all dependencies before importing the component
const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
}));

const mockSignIn = jest.fn();
jest.mock('../../src/contexts/AuthContext', () => ({
  useAuth: jest.fn(() => ({
    signIn: mockSignIn,
    session: null,
    loading: false,
  })),
}));

jest.mock('../../src/lib/passkey', () => ({
  authenticateWithPasskey: jest.fn(),
  hasStoredPasskey: jest.fn(),
}));

// Mock Linking
jest.spyOn(Linking, 'openURL').mockImplementation(() => Promise.resolve(true));

import LoginScreen from '../../app/login';
import { useAuth } from '../../src/contexts/AuthContext';
import { authenticateWithPasskey, hasStoredPasskey } from '../../src/lib/passkey';

describe('Login Screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPush.mockClear();
    mockReplace.mockClear();
    mockSignIn.mockClear();

    (useAuth as jest.Mock).mockReturnValue({
      signIn: mockSignIn,
      session: null,
      loading: false,
    });

    (hasStoredPasskey as jest.Mock).mockResolvedValue(false);
  });

  describe('Rendering', () => {
    it('shows email input field', async () => {
      (hasStoredPasskey as jest.Mock).mockResolvedValue(false);

      render(<LoginScreen />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Email')).toBeTruthy();
      });
    });

    it('shows password input field', async () => {
      render(<LoginScreen />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Password')).toBeTruthy();
      });
    });

    it('shows Sign In button', async () => {
      render(<LoginScreen />);

      await waitFor(() => {
        expect(screen.getByText('Sign In')).toBeTruthy();
      });
    });

    it('shows loading indicator while checking for passkey', () => {
      // Keep hasStoredPasskey pending
      (hasStoredPasskey as jest.Mock).mockImplementation(() => new Promise(() => {}));

      render(<LoginScreen />);

      // Should show activity indicator
      expect(screen.queryByPlaceholderText('Email')).toBeNull();
    });

    it('shows "Login with Fingerprint" when passkey is available', async () => {
      (hasStoredPasskey as jest.Mock).mockResolvedValue(true);

      render(<LoginScreen />);

      await waitFor(() => {
        expect(screen.getByText('Login with Fingerprint')).toBeTruthy();
      });
    });

    it('hides passkey button when no passkey is stored', async () => {
      (hasStoredPasskey as jest.Mock).mockResolvedValue(false);

      render(<LoginScreen />);

      await waitFor(() => {
        expect(screen.getByText('Sign In')).toBeTruthy();
      });

      expect(screen.queryByText('Login with Fingerprint')).toBeNull();
    });

    it('shows title GATEKEEPER', async () => {
      render(<LoginScreen />);

      await waitFor(() => {
        expect(screen.getByText('GATEKEEPER')).toBeTruthy();
      });
    });

    it('shows subtitle "Sign in to your account"', async () => {
      render(<LoginScreen />);

      await waitFor(() => {
        expect(screen.getByText('Sign in to your account')).toBeTruthy();
      });
    });
  });

  describe('Validation', () => {
    it('shows error when email is empty', async () => {
      render(<LoginScreen />);

      await waitFor(() => {
        expect(screen.getByText('Sign In')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Sign In'));

      await waitFor(() => {
        expect(screen.getByText('Please enter email and password')).toBeTruthy();
      });
    });

    it('shows error when password is empty', async () => {
      render(<LoginScreen />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Email')).toBeTruthy();
      });

      fireEvent.changeText(screen.getByPlaceholderText('Email'), 'test@example.com');
      fireEvent.press(screen.getByText('Sign In'));

      await waitFor(() => {
        expect(screen.getByText('Please enter email and password')).toBeTruthy();
      });
    });
  });

  describe('Authentication', () => {
    it('calls signIn with entered credentials', async () => {
      mockSignIn.mockResolvedValue(undefined);

      render(<LoginScreen />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Email')).toBeTruthy();
      });

      fireEvent.changeText(screen.getByPlaceholderText('Email'), 'test@example.com');
      fireEvent.changeText(screen.getByPlaceholderText('Password'), 'password123');
      fireEvent.press(screen.getByText('Sign In'));

      await waitFor(() => {
        expect(mockSignIn).toHaveBeenCalledWith('test@example.com', 'password123');
      });
    });

    it('shows error message on failed login', async () => {
      mockSignIn.mockRejectedValue(new Error('Invalid credentials'));

      render(<LoginScreen />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Email')).toBeTruthy();
      });

      fireEvent.changeText(screen.getByPlaceholderText('Email'), 'test@example.com');
      fireEvent.changeText(screen.getByPlaceholderText('Password'), 'wrongpassword');
      fireEvent.press(screen.getByText('Sign In'));

      await waitFor(() => {
        expect(screen.getByText('Invalid credentials')).toBeTruthy();
      });
    });

    it('navigates to dashboard on successful login', async () => {
      mockSignIn.mockResolvedValue(undefined);

      render(<LoginScreen />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Email')).toBeTruthy();
      });

      fireEvent.changeText(screen.getByPlaceholderText('Email'), 'test@example.com');
      fireEvent.changeText(screen.getByPlaceholderText('Password'), 'password123');
      fireEvent.press(screen.getByText('Sign In'));

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
      });
    });
  });

  describe('Passkey Authentication', () => {
    it('calls authenticateWithPasskey when passkey button pressed', async () => {
      (hasStoredPasskey as jest.Mock).mockResolvedValue(true);
      (authenticateWithPasskey as jest.Mock).mockResolvedValue({ success: true });

      render(<LoginScreen />);

      await waitFor(() => {
        expect(screen.getByText('Login with Fingerprint')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Login with Fingerprint'));

      await waitFor(() => {
        expect(authenticateWithPasskey).toHaveBeenCalled();
      });
    });

    it('navigates to dashboard on successful passkey auth', async () => {
      (hasStoredPasskey as jest.Mock).mockResolvedValue(true);
      (authenticateWithPasskey as jest.Mock).mockResolvedValue({ success: true });

      render(<LoginScreen />);

      await waitFor(() => {
        expect(screen.getByText('Login with Fingerprint')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Login with Fingerprint'));

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
      });
    });

    it('shows error on failed passkey auth', async () => {
      (hasStoredPasskey as jest.Mock).mockResolvedValue(true);
      (authenticateWithPasskey as jest.Mock).mockResolvedValue({
        success: false,
        error: 'User cancelled',
      });

      render(<LoginScreen />);

      await waitFor(() => {
        expect(screen.getByText('Login with Fingerprint')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Login with Fingerprint'));

      await waitFor(() => {
        expect(screen.getByText('User cancelled')).toBeTruthy();
      });
    });
  });

  describe('Navigation', () => {
    it('navigates to registration screen when sign up link pressed', async () => {
      render(<LoginScreen />);

      await waitFor(() => {
        expect(screen.getByText(/Sign up/)).toBeTruthy();
      });

      fireEvent.press(screen.getByText(/Sign up/));

      expect(mockPush).toHaveBeenCalledWith('/register');
    });
  });

  describe('Edge Cases', () => {
    it('handles hasStoredPasskey throwing exception', async () => {
      (hasStoredPasskey as jest.Mock).mockRejectedValue(new Error('Storage error'));

      render(<LoginScreen />);

      // Should not show passkey button when check fails
      await waitFor(() => {
        expect(screen.getByText('Sign In')).toBeTruthy();
      });

      expect(screen.queryByText('Login with Fingerprint')).toBeNull();
    });

    it('shows error when authenticateWithPasskey throws exception', async () => {
      (hasStoredPasskey as jest.Mock).mockResolvedValue(true);
      (authenticateWithPasskey as jest.Mock).mockRejectedValue(new Error('Hardware failure'));

      render(<LoginScreen />);

      await waitFor(() => {
        expect(screen.getByText('Login with Fingerprint')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Login with Fingerprint'));

      await waitFor(() => {
        expect(screen.getByText('Hardware failure')).toBeTruthy();
      });
    });
  });

  describe('Legal Links', () => {
    it('opens Terms of Service URL when pressed', async () => {
      render(<LoginScreen />);

      await waitFor(() => {
        expect(screen.getByText('Terms of Service')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Terms of Service'));

      expect(Linking.openURL).toHaveBeenCalledWith('https://gatekeeper-nine.vercel.app/terms');
    });

    it('opens Privacy Policy URL when pressed', async () => {
      render(<LoginScreen />);

      await waitFor(() => {
        expect(screen.getByText('Privacy Policy')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Privacy Policy'));

      expect(Linking.openURL).toHaveBeenCalledWith('https://gatekeeper-nine.vercel.app/privacy');
    });
  });
});
