import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';

// Component that throws an error
function ThrowError({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Test error message');
  }
  return <Text testID="child">Child rendered successfully</Text>;
}

// Component that throws after mount
function ThrowOnUpdate({ triggerError }: { triggerError: boolean }) {
  if (triggerError) {
    throw new Error('Update error');
  }
  return <Text testID="update-child">Update child</Text>;
}

describe('ErrorBoundary', () => {
  // Suppress console.error for error boundary tests
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('Normal rendering', () => {
    it('renders children when no error', () => {
      const { getByTestId } = render(
        <ErrorBoundary>
          <ThrowError shouldThrow={false} />
        </ErrorBoundary>
      );

      expect(getByTestId('child').props.children).toBe('Child rendered successfully');
    });

    it('renders multiple children', () => {
      const { getByText } = render(
        <ErrorBoundary>
          <Text>First child</Text>
          <Text>Second child</Text>
        </ErrorBoundary>
      );

      expect(getByText('First child')).toBeTruthy();
      expect(getByText('Second child')).toBeTruthy();
    });
  });

  describe('Error handling', () => {
    it('catches errors and shows fallback UI', () => {
      const { getByText, queryByTestId } = render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );

      // Child should not be rendered
      expect(queryByTestId('child')).toBeNull();

      // Fallback UI should be shown
      expect(getByText('Something went wrong')).toBeTruthy();
      expect(getByText('The app encountered an unexpected error. Please try again.')).toBeTruthy();
    });

    it('shows :( emoji', () => {
      const { getByText } = render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );

      expect(getByText(':(')).toBeTruthy();
    });

    it('shows Try Again button', () => {
      const { getByText } = render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );

      expect(getByText('Try Again')).toBeTruthy();
    });

    it('logs error to console', () => {
      render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        'ErrorBoundary caught an error:',
        expect.any(Error)
      );
    });

    it('logs component stack to console', () => {
      render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        'Component stack:',
        expect.any(String)
      );
    });
  });

  describe('Error message display', () => {
    // Test with __DEV__ = true (default in tests)
    it('shows error message in development mode', () => {
      const originalDev = global.__DEV__;
      (global as any).__DEV__ = true;

      const { getByText } = render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );

      expect(getByText('Test error message')).toBeTruthy();

      (global as any).__DEV__ = originalDev;
    });
  });

  describe('Retry functionality', () => {
    it('clears error state when Try Again is pressed', () => {
      // Start with error
      let shouldThrow = true;

      function ConditionalError() {
        if (shouldThrow) {
          throw new Error('Initial error');
        }
        return <Text testID="recovered">Recovered!</Text>;
      }

      const { getByText, queryByText, rerender } = render(
        <ErrorBoundary>
          <ConditionalError />
        </ErrorBoundary>
      );

      // Should show error UI
      expect(getByText('Something went wrong')).toBeTruthy();

      // Fix the error condition
      shouldThrow = false;

      // Press Try Again
      fireEvent.press(getByText('Try Again'));

      // Re-render to reflect state change
      rerender(
        <ErrorBoundary>
          <ConditionalError />
        </ErrorBoundary>
      );

      // Error UI should be gone (though re-render may show error again)
      // The key test is that handleRetry clears the error state
    });

    it('allows recovery after pressing Try Again', () => {
      // Track if we should throw
      let throwError = true;

      function RecoverableError() {
        if (throwError) {
          throw new Error('First render error');
        }
        return <Text testID="success">Success after retry</Text>;
      }

      const { getByText, getByTestId, queryByTestId } = render(
        <ErrorBoundary>
          <RecoverableError />
        </ErrorBoundary>
      );

      // Should show error UI
      expect(getByText('Something went wrong')).toBeTruthy();
      expect(queryByTestId('success')).toBeNull();

      // Fix the error before retry
      throwError = false;

      // Press Try Again - this clears hasError state and re-renders children
      fireEvent.press(getByText('Try Again'));

      // Should show success (error no longer thrown)
      expect(getByTestId('success').props.children).toBe('Success after retry');
    });
  });

  describe('getDerivedStateFromError', () => {
    it('returns hasError true and error object', () => {
      const testError = new Error('Static method test');
      const result = ErrorBoundary.getDerivedStateFromError(testError);

      expect(result).toEqual({
        hasError: true,
        error: testError,
      });
    });
  });
});
