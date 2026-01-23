import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import {
  checkBiometricStatus,
  isBiometricEnabled,
  setBiometricEnabled,
  saveCredentials,
  getCredentials,
  authenticateWithBiometrics,
} from '../../src/lib/security';

describe('security.ts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkBiometricStatus()', () => {
    it('returns hasHardware and isEnrolled status', async () => {
      (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
      (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(true);

      const result = await checkBiometricStatus();

      expect(result).toEqual({
        hasHardware: true,
        isEnrolled: true,
      });
    });

    it('returns false for both when no hardware', async () => {
      (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(false);
      (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(false);

      const result = await checkBiometricStatus();

      expect(result).toEqual({
        hasHardware: false,
        isEnrolled: false,
      });
    });

    it('returns hasHardware true but isEnrolled false when not set up', async () => {
      (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
      (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(false);

      const result = await checkBiometricStatus();

      expect(result).toEqual({
        hasHardware: true,
        isEnrolled: false,
      });
    });
  });

  describe('isBiometricEnabled()', () => {
    it('returns true when enabled flag is "true"', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('true');

      const result = await isBiometricEnabled();

      expect(result).toBe(true);
      expect(SecureStore.getItemAsync).toHaveBeenCalledWith('gatekeeper_biometric_enabled');
    });

    it('returns false when enabled flag is "false"', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('false');

      const result = await isBiometricEnabled();

      expect(result).toBe(false);
    });

    it('returns false when enabled flag is null', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);

      const result = await isBiometricEnabled();

      expect(result).toBe(false);
    });

    it('returns false for any other value', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('yes');

      const result = await isBiometricEnabled();

      expect(result).toBe(false);
    });
  });

  describe('setBiometricEnabled()', () => {
    it('stores "true" when enabling biometrics', async () => {
      await setBiometricEnabled(true);

      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        'gatekeeper_biometric_enabled',
        'true'
      );
    });

    it('stores "false" when disabling biometrics', async () => {
      await setBiometricEnabled(false);

      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        'gatekeeper_biometric_enabled',
        'false'
      );
    });

    it('deletes stored credentials when disabling biometrics', async () => {
      await setBiometricEnabled(false);

      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('gatekeeper_user_credentials');
    });

    it('does not delete credentials when enabling biometrics', async () => {
      await setBiometricEnabled(true);

      expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    });
  });

  describe('saveCredentials()', () => {
    it('stores credentials as JSON in SecureStore', async () => {
      await saveCredentials('test@example.com', 'mypassword');

      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        'gatekeeper_user_credentials',
        JSON.stringify({ email: 'test@example.com', password: 'mypassword' }),
        { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
      );
    });

    it('uses WHEN_UNLOCKED_THIS_DEVICE_ONLY security level', async () => {
      await saveCredentials('test@example.com', 'password');

      const call = (SecureStore.setItemAsync as jest.Mock).mock.calls[0];
      expect(call[2]).toEqual({
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    });

    it('handles special characters in credentials', async () => {
      await saveCredentials('user+test@example.com', 'p@ss"word\'123');

      const storedValue = (SecureStore.setItemAsync as jest.Mock).mock.calls[0][1];
      const parsed = JSON.parse(storedValue);

      expect(parsed.email).toBe('user+test@example.com');
      expect(parsed.password).toBe('p@ss"word\'123');
    });
  });

  describe('getCredentials()', () => {
    it('returns parsed credentials from SecureStore', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(
        JSON.stringify({ email: 'test@example.com', password: 'mypassword' })
      );

      const result = await getCredentials();

      expect(result).toEqual({
        email: 'test@example.com',
        password: 'mypassword',
      });
    });

    it('returns null when no credentials stored', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);

      const result = await getCredentials();

      expect(result).toBeNull();
    });

    it('returns null when stored value is invalid JSON', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('not valid json');

      const result = await getCredentials();

      expect(result).toBeNull();
    });

    it('returns null when stored value is empty string', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('');

      const result = await getCredentials();

      expect(result).toBeNull();
    });
  });

  describe('authenticateWithBiometrics()', () => {
    it('returns true on successful authentication', async () => {
      (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
      (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(true);
      (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValue({
        success: true,
      });

      const result = await authenticateWithBiometrics();

      expect(result).toBe(true);
    });

    it('returns false when user cancels authentication', async () => {
      (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
      (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(true);
      (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValue({
        success: false,
        error: 'user_cancel',
      });

      const result = await authenticateWithBiometrics();

      expect(result).toBe(false);
    });

    it('returns false when no biometric hardware', async () => {
      (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(false);
      (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(false);

      const result = await authenticateWithBiometrics();

      expect(result).toBe(false);
      expect(LocalAuthentication.authenticateAsync).not.toHaveBeenCalled();
    });

    it('returns false when biometrics not enrolled', async () => {
      (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
      (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(false);

      const result = await authenticateWithBiometrics();

      expect(result).toBe(false);
      expect(LocalAuthentication.authenticateAsync).not.toHaveBeenCalled();
    });

    it('uses default prompt message', async () => {
      (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
      (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(true);
      (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValue({
        success: true,
      });

      await authenticateWithBiometrics();

      expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledWith({
        promptMessage: 'Log in to Gatekeeper',
        fallbackLabel: 'Use Password',
        disableDeviceFallback: false,
      });
    });

    it('uses custom prompt message when provided', async () => {
      (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
      (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(true);
      (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValue({
        success: true,
      });

      await authenticateWithBiometrics('Confirm your identity');

      expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledWith({
        promptMessage: 'Confirm your identity',
        fallbackLabel: 'Use Password',
        disableDeviceFallback: false,
      });
    });

    it('allows device fallback (password/PIN)', async () => {
      (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
      (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(true);
      (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValue({
        success: true,
      });

      await authenticateWithBiometrics();

      const authCall = (LocalAuthentication.authenticateAsync as jest.Mock).mock.calls[0][0];
      expect(authCall.disableDeviceFallback).toBe(false);
    });
  });
});
