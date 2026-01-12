import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const BIOMETRIC_ENABLED_KEY = 'gatekeeper_biometric_enabled';
const USER_CREDENTIALS_KEY = 'gatekeeper_user_credentials';

export interface BiometricStatus {
  hasHardware: boolean;
  isEnrolled: boolean;
}

export async function checkBiometricStatus(): Promise<BiometricStatus> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();
  return { hasHardware, isEnrolled };
}

export async function isBiometricEnabled(): Promise<boolean> {
  const enabled = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
  return enabled === 'true';
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, enabled ? 'true' : 'false');
  if (!enabled) {
    await SecureStore.deleteItemAsync(USER_CREDENTIALS_KEY);
  }
}

export async function saveCredentials(email: string, password: string): Promise<void> {
  const credentials = JSON.stringify({ email, password });
  await SecureStore.setItemAsync(USER_CREDENTIALS_KEY, credentials, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function getCredentials(): Promise<{ email: string; password: string } | null> {
  const credentials = await SecureStore.getItemAsync(USER_CREDENTIALS_KEY);
  if (!credentials) return null;
  try {
    return JSON.parse(credentials);
  } catch {
    return null;
  }
}

export async function authenticateWithBiometrics(reason: string = 'Log in to Gatekeeper'): Promise<boolean> {
  const status = await checkBiometricStatus();
  if (!status.hasHardware || !status.isEnrolled) return false;

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    fallbackLabel: 'Use Password',
    disableDeviceFallback: false,
  });

  return result.success;
}
