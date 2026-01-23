import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';

// Mock dependencies
jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(),
}));

jest.mock('../../src/contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../src/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
    },
  },
}));

jest.mock('../../src/lib/attestation', () => ({
  issueAttestation: jest.fn(),
  buildCallbackUrl: jest.fn(),
  buildCancelledCallbackUrl: jest.fn(),
}));

jest.mock('../../src/lib/linking', () => ({
  isValidCallbackUrl: jest.fn(),
  openUrl: jest.fn(),
}));

jest.mock('../../src/lib/security', () => ({
  authenticateWithBiometrics: jest.fn(),
  getBiometricStatus: jest.fn(),
}));

import AuthScreen from '../../app/auth';
import { useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../src/contexts/AuthContext';
import { supabase } from '../../src/lib/supabase';
import { issueAttestation, buildCallbackUrl, buildCancelledCallbackUrl } from '../../src/lib/attestation';
import { isValidCallbackUrl, openUrl } from '../../src/lib/linking';
import { authenticateWithBiometrics, getBiometricStatus } from '../../src/lib/security';

describe('Auth Screen', () => {
  const mockSession = {
    access_token: 'test-token',
    user: { email: 'test@example.com' },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    (useLocalSearchParams as jest.Mock).mockReturnValue({
      callback: 'dawgtag://callback',
    });

    (useAuth as jest.Mock).mockReturnValue({
      session: null,
      loading: false,
    });

    (isValidCallbackUrl as jest.Mock).mockReturnValue(true);
    (getBiometricStatus as jest.Mock).mockResolvedValue({
      hasHardware: false,
      isEnrolled: false,
    });
  });

  describe('Invalid Callback URL', () => {
    it('shows error when callback URL is invalid', async () => {
      (isValidCallbackUrl as jest.Mock).mockReturnValue(false);

      render(<AuthScreen />);

      await waitFor(() => {
        expect(screen.getByText('Authentication Error')).toBeTruthy();
        expect(screen.getByText('Invalid callback URL.')).toBeTruthy();
      });
    });

    it('does not show login form when callback is invalid', async () => {
      (isValidCallbackUrl as jest.Mock).mockReturnValue(false);

      render(<AuthScreen />);

      await waitFor(() => {
        expect(screen.queryByPlaceholderText('Email')).toBeNull();
        expect(screen.queryByPlaceholderText('Password')).toBeNull();
      });
    });
  });

  describe('Password Login Flow', () => {
    it('shows email and password inputs when no session', async () => {
      render(<AuthScreen />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Email')).toBeTruthy();
        expect(screen.getByPlaceholderText('Password')).toBeTruthy();
      });
    });

    it('shows Sign In button', async () => {
      render(<AuthScreen />);

      await waitFor(() => {
        expect(screen.getByText('Sign In')).toBeTruthy();
      });
    });

    it('calls supabase signIn on form submit', async () => {
      (supabase.auth.signInWithPassword as jest.Mock).mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });
      (issueAttestation as jest.Mock).mockResolvedValue({
        attestation: 'test-attestation',
      });
      (buildCallbackUrl as jest.Mock).mockReturnValue('dawgtag://callback?attestation=test');

      render(<AuthScreen />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Email')).toBeTruthy();
      });

      fireEvent.changeText(screen.getByPlaceholderText('Email'), 'test@example.com');
      fireEvent.changeText(screen.getByPlaceholderText('Password'), 'password123');
      fireEvent.press(screen.getByText('Sign In'));

      await waitFor(() => {
        expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
          email: 'test@example.com',
          password: 'password123',
        });
      });
    });

    it('issues attestation after successful login', async () => {
      (supabase.auth.signInWithPassword as jest.Mock).mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });
      (issueAttestation as jest.Mock).mockResolvedValue({
        attestation: 'test-attestation',
      });
      (buildCallbackUrl as jest.Mock).mockReturnValue('dawgtag://callback?attestation=test');

      render(<AuthScreen />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Email')).toBeTruthy();
      });

      fireEvent.changeText(screen.getByPlaceholderText('Email'), 'test@example.com');
      fireEvent.changeText(screen.getByPlaceholderText('Password'), 'password123');
      fireEvent.press(screen.getByText('Sign In'));

      await waitFor(() => {
        expect(issueAttestation).toHaveBeenCalledWith(mockSession);
      });
    });

    it('opens callback URL with attestation', async () => {
      (supabase.auth.signInWithPassword as jest.Mock).mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });
      (issueAttestation as jest.Mock).mockResolvedValue({
        attestation: 'test-attestation',
      });
      (buildCallbackUrl as jest.Mock).mockReturnValue('dawgtag://callback?attestation=test&status=success');

      render(<AuthScreen />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Email')).toBeTruthy();
      });

      fireEvent.changeText(screen.getByPlaceholderText('Email'), 'test@example.com');
      fireEvent.changeText(screen.getByPlaceholderText('Password'), 'password123');
      fireEvent.press(screen.getByText('Sign In'));

      await waitFor(() => {
        expect(openUrl).toHaveBeenCalledWith('dawgtag://callback?attestation=test&status=success');
      });
    });

    it('shows error on failed login', async () => {
      (supabase.auth.signInWithPassword as jest.Mock).mockResolvedValue({
        data: { session: null },
        error: { message: 'Invalid credentials' },
      });

      render(<AuthScreen />);

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
  });

  describe('Biometric Login Flow', () => {
    beforeEach(() => {
      (useAuth as jest.Mock).mockReturnValue({
        session: mockSession,
        loading: false,
      });
      (getBiometricStatus as jest.Mock).mockResolvedValue({
        hasHardware: true,
        isEnrolled: true,
      });
    });

    it('shows biometric login button when session exists and biometrics available', async () => {
      render(<AuthScreen />);

      await waitFor(() => {
        expect(screen.getByText('Log in with Biometrics')).toBeTruthy();
      });
    });

    it('shows current user email when session exists', async () => {
      render(<AuthScreen />);

      await waitFor(() => {
        expect(screen.getByText('test@example.com')).toBeTruthy();
      });
    });

    it('calls authenticateWithBiometrics when button pressed', async () => {
      (authenticateWithBiometrics as jest.Mock).mockResolvedValue(true);
      (issueAttestation as jest.Mock).mockResolvedValue({
        attestation: 'test-attestation',
      });
      (buildCallbackUrl as jest.Mock).mockReturnValue('dawgtag://callback?attestation=test');

      render(<AuthScreen />);

      await waitFor(() => {
        expect(screen.getByText('Log in with Biometrics')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Log in with Biometrics'));

      await waitFor(() => {
        expect(authenticateWithBiometrics).toHaveBeenCalledWith('Log in to Dawg Tag');
      });
    });

    it('shows error when biometric authentication throws', async () => {
      (authenticateWithBiometrics as jest.Mock).mockRejectedValue(new Error('Hardware error'));

      render(<AuthScreen />);

      await waitFor(() => {
        expect(screen.getByText('Log in with Biometrics')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Log in with Biometrics'));

      await waitFor(() => {
        expect(screen.getByText('Biometric authentication failed.')).toBeTruthy();
      });
    });

    it('shows "Use a different account" link', async () => {
      render(<AuthScreen />);

      await waitFor(() => {
        expect(screen.getByText('Use a different account')).toBeTruthy();
      });
    });

    it('calls signOut when "Use a different account" is pressed', async () => {
      render(<AuthScreen />);

      await waitFor(() => {
        expect(screen.getByText('Use a different account')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Use a different account'));

      await waitFor(() => {
        expect(supabase.auth.signOut).toHaveBeenCalled();
      });
    });
  });

  describe('Cancel Flow', () => {
    it('shows Cancel button', async () => {
      render(<AuthScreen />);

      await waitFor(() => {
        expect(screen.getByText('Cancel')).toBeTruthy();
      });
    });

    it('opens cancelled callback URL when Cancel pressed', async () => {
      (buildCancelledCallbackUrl as jest.Mock).mockReturnValue('dawgtag://callback?status=cancelled');

      render(<AuthScreen />);

      await waitFor(() => {
        expect(screen.getByText('Cancel')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Cancel'));

      await waitFor(() => {
        expect(buildCancelledCallbackUrl).toHaveBeenCalledWith('dawgtag://callback');
        expect(openUrl).toHaveBeenCalledWith('dawgtag://callback?status=cancelled');
      });
    });
  });

  describe('Redirecting State', () => {
    it('shows redirecting message after successful auth', async () => {
      (supabase.auth.signInWithPassword as jest.Mock).mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });
      (issueAttestation as jest.Mock).mockResolvedValue({
        attestation: 'test-attestation',
      });
      (buildCallbackUrl as jest.Mock).mockReturnValue('dawgtag://callback?attestation=test');

      render(<AuthScreen />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Email')).toBeTruthy();
      });

      fireEvent.changeText(screen.getByPlaceholderText('Email'), 'test@example.com');
      fireEvent.changeText(screen.getByPlaceholderText('Password'), 'password123');
      fireEvent.press(screen.getByText('Sign In'));

      await waitFor(() => {
        expect(screen.getByText('Redirecting to Dawg Tag...')).toBeTruthy();
      });
    });
  });

  describe('Footer', () => {
    it('shows privacy footer text', async () => {
      render(<AuthScreen />);

      await waitFor(() => {
        expect(screen.getByText(/Your credentials are verified by Gatekeeper/)).toBeTruthy();
        expect(screen.getByText(/Your identity stays private with Dawg Tag/)).toBeTruthy();
      });
    });
  });
});
