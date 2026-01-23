import React from 'react';
import { render, waitFor, act } from '@testing-library/react-native';
import { Text } from 'react-native';

// Mock supabase before importing AuthContext
const mockGetSession = jest.fn();
const mockOnAuthStateChange = jest.fn();
const mockSignInWithPassword = jest.fn();
const mockSignUp = jest.fn();
const mockSignOut = jest.fn();

jest.mock('../../src/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      onAuthStateChange: (callback: Function) => {
        mockOnAuthStateChange(callback);
        return {
          data: {
            subscription: {
              unsubscribe: jest.fn(),
            },
          },
        };
      },
      signInWithPassword: (params: any) => mockSignInWithPassword(params),
      signUp: (params: any) => mockSignUp(params),
      signOut: () => mockSignOut(),
    },
  },
}));

import { AuthProvider, useAuth } from '../../src/contexts/AuthContext';

// Test component that uses useAuth
function TestConsumer({ testId }: { testId?: string }) {
  const { session, user, loading, signIn, signUp, signOut } = useAuth();
  return (
    <>
      <Text testID="loading">{loading ? 'loading' : 'ready'}</Text>
      <Text testID="session">{session ? 'has-session' : 'no-session'}</Text>
      <Text testID="user-email">{user?.email || 'no-user'}</Text>
    </>
  );
}

describe('AuthContext', () => {
  const mockSession = {
    access_token: 'test-token',
    refresh_token: 'refresh-token',
    user: {
      id: 'user-123',
      email: 'test@example.com',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Default: no session
    mockGetSession.mockResolvedValue({
      data: { session: null },
    });
  });

  describe('AuthProvider', () => {
    it('provides auth context to children', async () => {
      const { getByTestId } = render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(getByTestId('loading').props.children).toBe('ready');
      });
    });

    it('starts in loading state', () => {
      // Keep getSession pending
      mockGetSession.mockImplementation(() => new Promise(() => {}));

      const { getByTestId } = render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      );

      expect(getByTestId('loading').props.children).toBe('loading');
    });

    it('loads existing session on mount', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: mockSession },
      });

      const { getByTestId } = render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(getByTestId('session').props.children).toBe('has-session');
        expect(getByTestId('user-email').props.children).toBe('test@example.com');
      });
    });

    it('sets loading to false after checking session', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: null },
      });

      const { getByTestId } = render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(getByTestId('loading').props.children).toBe('ready');
      });
    });

    it('subscribes to auth state changes', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: null },
      });

      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(mockOnAuthStateChange).toHaveBeenCalled();
      });
    });

    it('updates state when auth state changes', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: null },
      });

      let authStateCallback: Function;
      mockOnAuthStateChange.mockImplementation((callback) => {
        authStateCallback = callback;
        return {
          data: {
            subscription: {
              unsubscribe: jest.fn(),
            },
          },
        };
      });

      const { getByTestId } = render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(getByTestId('session').props.children).toBe('no-session');
      });

      // Simulate auth state change
      act(() => {
        authStateCallback!('SIGNED_IN', mockSession);
      });

      await waitFor(() => {
        expect(getByTestId('session').props.children).toBe('has-session');
        expect(getByTestId('user-email').props.children).toBe('test@example.com');
      });
    });
  });

  describe('useAuth hook', () => {
    it('throws error when used outside AuthProvider', () => {
      // Suppress console.error for this test
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      expect(() => {
        render(<TestConsumer />);
      }).toThrow('useAuth must be used within an AuthProvider');

      consoleSpy.mockRestore();
    });
  });

  describe('signIn', () => {
    it('calls supabase signInWithPassword', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: null },
      });
      mockSignInWithPassword.mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      let signInFn: Function;

      function SignInTestComponent() {
        const { signIn } = useAuth();
        signInFn = signIn;
        return <Text>Test</Text>;
      }

      render(
        <AuthProvider>
          <SignInTestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(signInFn).toBeDefined();
      });

      await act(async () => {
        await signInFn('test@example.com', 'password123');
      });

      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      });
    });

    it('throws error when signIn fails', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: null },
      });
      mockSignInWithPassword.mockResolvedValue({
        data: { session: null },
        error: { message: 'Invalid credentials' },
      });

      let signInFn: Function;

      function SignInTestComponent() {
        const { signIn } = useAuth();
        signInFn = signIn;
        return <Text>Test</Text>;
      }

      render(
        <AuthProvider>
          <SignInTestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(signInFn).toBeDefined();
      });

      await expect(
        act(async () => {
          await signInFn('test@example.com', 'wrong');
        })
      ).rejects.toEqual({ message: 'Invalid credentials' });
    });

    it('throws error when no session returned', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: null },
      });
      mockSignInWithPassword.mockResolvedValue({
        data: { session: null },
        error: null,
      });

      let signInFn: Function;

      function SignInTestComponent() {
        const { signIn } = useAuth();
        signInFn = signIn;
        return <Text>Test</Text>;
      }

      render(
        <AuthProvider>
          <SignInTestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(signInFn).toBeDefined();
      });

      await expect(
        act(async () => {
          await signInFn('test@example.com', 'password');
        })
      ).rejects.toThrow('No session returned');
    });
  });

  describe('signUp', () => {
    it('calls supabase signUp', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: null },
      });
      mockSignUp.mockResolvedValue({
        data: {},
        error: null,
      });

      let signUpFn: Function;

      function SignUpTestComponent() {
        const { signUp } = useAuth();
        signUpFn = signUp;
        return <Text>Test</Text>;
      }

      render(
        <AuthProvider>
          <SignUpTestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(signUpFn).toBeDefined();
      });

      await act(async () => {
        await signUpFn('new@example.com', 'password123');
      });

      expect(mockSignUp).toHaveBeenCalledWith({
        email: 'new@example.com',
        password: 'password123',
      });
    });

    it('throws error when signUp fails', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: null },
      });
      mockSignUp.mockResolvedValue({
        data: null,
        error: { message: 'User already registered' },
      });

      let signUpFn: Function;

      function SignUpTestComponent() {
        const { signUp } = useAuth();
        signUpFn = signUp;
        return <Text>Test</Text>;
      }

      render(
        <AuthProvider>
          <SignUpTestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(signUpFn).toBeDefined();
      });

      await expect(
        act(async () => {
          await signUpFn('existing@example.com', 'password');
        })
      ).rejects.toEqual({ message: 'User already registered' });
    });
  });

  describe('signOut', () => {
    it('calls supabase signOut', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: mockSession },
      });
      mockSignOut.mockResolvedValue({ error: null });

      let signOutFn: Function;

      function SignOutTestComponent() {
        const { signOut } = useAuth();
        signOutFn = signOut;
        return <Text>Test</Text>;
      }

      render(
        <AuthProvider>
          <SignOutTestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(signOutFn).toBeDefined();
      });

      await act(async () => {
        await signOutFn();
      });

      expect(mockSignOut).toHaveBeenCalled();
    });

    it('clears local state even if signOut fails', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: mockSession },
      });
      mockSignOut.mockRejectedValue(new Error('Network error'));

      // Suppress console.log for this test
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      let signOutFn: Function;

      function SignOutTestComponent() {
        const { signOut, session } = useAuth();
        signOutFn = signOut;
        return <Text testID="session">{session ? 'has-session' : 'no-session'}</Text>;
      }

      const { getByTestId } = render(
        <AuthProvider>
          <SignOutTestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(getByTestId('session').props.children).toBe('has-session');
      });

      await act(async () => {
        await signOutFn();
      });

      // Session should be cleared even after error
      await waitFor(() => {
        expect(getByTestId('session').props.children).toBe('no-session');
      });

      consoleSpy.mockRestore();
    });
  });
});
