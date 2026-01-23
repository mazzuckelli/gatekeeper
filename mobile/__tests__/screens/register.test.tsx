import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';

// Mock dependencies before importing components
const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
}));

const mockSignUp = jest.fn();
jest.mock('../../src/contexts/AuthContext', () => ({
  useAuth: jest.fn(() => ({
    signUp: mockSignUp,
  })),
}));

// Mock Alert
jest.spyOn(Alert, 'alert');

// Mock Linking
jest.spyOn(Linking, 'openURL').mockImplementation(() => Promise.resolve(true));

import RegisterScreen from '../../app/register';
import { useAuth } from '../../src/contexts/AuthContext';

describe('Register Screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPush.mockClear();
    mockReplace.mockClear();
    mockSignUp.mockClear();

    (useAuth as jest.Mock).mockReturnValue({
      signUp: mockSignUp,
    });
  });

  describe('Rendering', () => {
    it('shows email input field', () => {
      render(<RegisterScreen />);
      expect(screen.getByPlaceholderText('Email')).toBeTruthy();
    });

    it('shows password input field', () => {
      render(<RegisterScreen />);
      expect(screen.getByPlaceholderText('Password')).toBeTruthy();
    });

    it('shows confirm password input field', () => {
      render(<RegisterScreen />);
      expect(screen.getByPlaceholderText('Confirm Password')).toBeTruthy();
    });

    it('shows Create Account button', () => {
      render(<RegisterScreen />);
      expect(screen.getByText('Create Account')).toBeTruthy();
    });

    it('shows title GATEKEEPER', () => {
      render(<RegisterScreen />);
      expect(screen.getByText('GATEKEEPER')).toBeTruthy();
    });

    it('shows subtitle "Create your account"', () => {
      render(<RegisterScreen />);
      expect(screen.getByText('Create your account')).toBeTruthy();
    });

    it('shows terms agreement text', () => {
      render(<RegisterScreen />);
      expect(screen.getByText(/By creating an account, you agree to our/)).toBeTruthy();
    });

    it('shows Terms of Service link', () => {
      render(<RegisterScreen />);
      expect(screen.getByText('Terms of Service')).toBeTruthy();
    });

    it('shows Privacy Policy link', () => {
      render(<RegisterScreen />);
      expect(screen.getByText('Privacy Policy')).toBeTruthy();
    });
  });

  describe('Validation', () => {
    it('shows error when all fields are empty', async () => {
      render(<RegisterScreen />);

      fireEvent.press(screen.getByText('Create Account'));

      await waitFor(() => {
        expect(screen.getByText('Please fill in all fields')).toBeTruthy();
      });
    });

    it('shows error when passwords do not match', async () => {
      render(<RegisterScreen />);

      fireEvent.changeText(screen.getByPlaceholderText('Email'), 'test@example.com');
      fireEvent.changeText(screen.getByPlaceholderText('Password'), 'password123');
      fireEvent.changeText(screen.getByPlaceholderText('Confirm Password'), 'different123');
      fireEvent.press(screen.getByText('Create Account'));

      await waitFor(() => {
        expect(screen.getByText('Passwords do not match')).toBeTruthy();
      });
    });

    it('shows error when password is less than 8 characters', async () => {
      render(<RegisterScreen />);

      fireEvent.changeText(screen.getByPlaceholderText('Email'), 'test@example.com');
      fireEvent.changeText(screen.getByPlaceholderText('Password'), 'short');
      fireEvent.changeText(screen.getByPlaceholderText('Confirm Password'), 'short');
      fireEvent.press(screen.getByText('Create Account'));

      await waitFor(() => {
        expect(screen.getByText('Password must be at least 8 characters')).toBeTruthy();
      });
    });

    it('does not call signUp when validation fails', async () => {
      render(<RegisterScreen />);

      fireEvent.press(screen.getByText('Create Account'));

      await waitFor(() => {
        expect(screen.getByText('Please fill in all fields')).toBeTruthy();
      });

      expect(mockSignUp).not.toHaveBeenCalled();
    });
  });

  describe('Registration', () => {
    it('calls signUp with email and password', async () => {
      mockSignUp.mockResolvedValue(undefined);

      render(<RegisterScreen />);

      fireEvent.changeText(screen.getByPlaceholderText('Email'), 'new@example.com');
      fireEvent.changeText(screen.getByPlaceholderText('Password'), 'password123');
      fireEvent.changeText(screen.getByPlaceholderText('Confirm Password'), 'password123');
      fireEvent.press(screen.getByText('Create Account'));

      await waitFor(() => {
        expect(mockSignUp).toHaveBeenCalledWith('new@example.com', 'password123');
      });
    });

    it('shows confirmation alert on successful registration', async () => {
      mockSignUp.mockResolvedValue(undefined);

      render(<RegisterScreen />);

      fireEvent.changeText(screen.getByPlaceholderText('Email'), 'new@example.com');
      fireEvent.changeText(screen.getByPlaceholderText('Password'), 'password123');
      fireEvent.changeText(screen.getByPlaceholderText('Confirm Password'), 'password123');
      fireEvent.press(screen.getByText('Create Account'));

      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith(
          'Check your email',
          'We sent you a confirmation link. Please verify your email to continue.',
          expect.any(Array)
        );
      });
    });

    it('shows error message on failed registration', async () => {
      mockSignUp.mockRejectedValue(new Error('User already registered'));

      render(<RegisterScreen />);

      fireEvent.changeText(screen.getByPlaceholderText('Email'), 'existing@example.com');
      fireEvent.changeText(screen.getByPlaceholderText('Password'), 'password123');
      fireEvent.changeText(screen.getByPlaceholderText('Confirm Password'), 'password123');
      fireEvent.press(screen.getByText('Create Account'));

      await waitFor(() => {
        expect(screen.getByText('User already registered')).toBeTruthy();
      });
    });
  });

  describe('Navigation', () => {
    it('navigates to login screen when sign in link pressed', () => {
      render(<RegisterScreen />);

      fireEvent.press(screen.getByText(/Sign in/));

      expect(mockPush).toHaveBeenCalledWith('/login');
    });

    it('navigates to login when Alert OK button is pressed', async () => {
      mockSignUp.mockResolvedValue(undefined);

      // Mock Alert to call the onPress handler
      (Alert.alert as jest.Mock).mockImplementation((title, message, buttons) => {
        const okButton = buttons?.find((b: any) => b.text === 'OK');
        if (okButton?.onPress) {
          okButton.onPress();
        }
      });

      render(<RegisterScreen />);

      fireEvent.changeText(screen.getByPlaceholderText('Email'), 'new@example.com');
      fireEvent.changeText(screen.getByPlaceholderText('Password'), 'password123');
      fireEvent.changeText(screen.getByPlaceholderText('Confirm Password'), 'password123');
      fireEvent.press(screen.getByText('Create Account'));

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/login');
      });
    });
  });

  describe('Legal Links', () => {
    it('opens Terms of Service URL when pressed', () => {
      render(<RegisterScreen />);

      fireEvent.press(screen.getByText('Terms of Service'));

      expect(Linking.openURL).toHaveBeenCalledWith('https://gatekeeper-nine.vercel.app/terms');
    });

    it('opens Privacy Policy URL when pressed', () => {
      render(<RegisterScreen />);

      fireEvent.press(screen.getByText('Privacy Policy'));

      expect(Linking.openURL).toHaveBeenCalledWith('https://gatekeeper-nine.vercel.app/privacy');
    });
  });
});
