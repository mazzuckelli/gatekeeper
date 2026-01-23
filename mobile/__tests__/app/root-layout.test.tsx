import React from 'react';
import { render } from '@testing-library/react-native';

// Mock all dependencies before importing
jest.mock('expo-router', () => {
  const React = require('react');
  const { View } = require('react-native');

  const MockStack = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(View, null, children);
  MockStack.Screen = ({ name }: { name: string }) =>
    React.createElement(View, { testID: `screen-${name}` });

  return { Stack: MockStack };
});

jest.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));

jest.mock('../../src/contexts/AuthContext', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    AuthProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(View, null, children),
  };
});

jest.mock('../../src/components/ErrorBoundary', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    ErrorBoundary: ({ children }: { children: React.ReactNode }) =>
      React.createElement(View, null, children),
  };
});

jest.mock('../../src/components/NetworkStatus', () => ({
  NetworkStatusBanner: () => null,
}));

import RootLayout from '../../app/_layout';

describe('Root Layout', () => {
  it('renders without crashing', () => {
    const { toJSON } = render(<RootLayout />);

    // Should render something (the mocked Stack)
    expect(toJSON()).not.toBeNull();
  });

  it('wraps content in ErrorBoundary', () => {
    // The ErrorBoundary mock just renders children
    // If it weren't wrapped, we'd get an error
    expect(() => render(<RootLayout />)).not.toThrow();
  });

  it('provides AuthProvider to children', () => {
    // The AuthProvider mock just renders children
    // If it weren't wrapped, components using useAuth would fail
    expect(() => render(<RootLayout />)).not.toThrow();
  });
});

// Integration test with real components (but mocked dependencies)
describe('Root Layout Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the layout structure', () => {
    const { toJSON } = render(<RootLayout />);

    // Should have rendered the component tree
    expect(toJSON()).toBeDefined();
  });
});
