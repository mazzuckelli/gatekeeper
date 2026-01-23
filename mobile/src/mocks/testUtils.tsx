import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { AuthProvider } from '../contexts/AuthContext';

// Mock navigation state
const navState = {
  index: 0,
  routes: [{ name: 'index', key: 'index-key' }],
};

// Wrapper with all providers
function AllProviders({ children }: { children: React.ReactNode }) {
  return (
    <NavigationContainer initialState={navState}>
      <AuthProvider>
        {children}
      </AuthProvider>
    </NavigationContainer>
  );
}

// Custom render with providers
function customRender(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  return render(ui, { wrapper: AllProviders, ...options });
}

// Re-export everything from testing library
export * from '@testing-library/react-native';

// Override render with custom render
export { customRender as render };

// Mock authenticated user for tests
export const mockAuthenticatedUser = {
  id: 'test-user-id-123',
  email: 'test@example.com',
  created_at: '2024-01-01T00:00:00Z',
};

// Mock session for tests
export const mockSession = {
  access_token: 'mock-access-token-xyz',
  refresh_token: 'mock-refresh-token-xyz',
  expires_in: 3600,
  token_type: 'bearer',
  user: mockAuthenticatedUser,
};

// Helper to wait for async operations
export const waitForAsync = () => new Promise(resolve => setTimeout(resolve, 0));

// Helper to create mock passkey credential
export const createMockCredential = (id: string = 'mock-credential-id') => ({
  id,
  rawId: id,
  type: 'public-key',
  response: {
    clientDataJSON: 'eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0',
    attestationObject: 'o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YQ',
    authenticatorData: 'dGVzdC1hdXRoZW50aWNhdG9yLWRhdGE',
    signature: 'dGVzdC1zaWduYXR1cmU',
    userHandle: 'dGVzdC11c2VyLWhhbmRsZQ',
  },
  authenticatorAttachment: 'platform',
});

// Helper to simulate user typing
export const typeText = async (
  getByPlaceholder: (text: string) => any,
  placeholder: string,
  text: string
) => {
  const { fireEvent } = await import('@testing-library/react-native');
  const input = getByPlaceholder(placeholder);
  fireEvent.changeText(input, text);
};
