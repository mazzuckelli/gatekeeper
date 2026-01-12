import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const GHOST_SECRET_KEY = 'gatekeeper_ghost_secret';

export interface BiometricStatus {
  hasHardware: boolean;
  isEnrolled: boolean;
  supportedTypes: LocalAuthentication.AuthenticationType[];
}

/**
 * Check if the device supports biometrics and has them enrolled
 */
export async function getBiometricStatus(): Promise<BiometricStatus> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();
  const supportedTypes = await LocalAuthentication.supportedAuthenticationTypesAsync();

  return {
    hasHardware,
    isEnrolled,
    supportedTypes,
  };
}

/**
 * Authenticate the user using biometrics
 * 
 * @param reason - Reason for biometric prompt (e.g. "Log into Dawg Tag")
 */
export async function authenticateWithBiometrics(reason: string = 'Authenticate with Gatekeeper'): Promise<boolean> {
  const status = await getBiometricStatus();
  
  if (!status.hasHardware || !status.isEnrolled) {
    return false;
  }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    fallbackLabel: 'Use Passcode',
    disableDeviceFallback: false,
    cancelLabel: 'Cancel',
  });

  return result.success;
}

/**
 * Securely store the ghost_secret
 * 
 * In a real implementation, we would generate this cryptographically.
 * For now, we'll store a placeholder or passed value.
 */
export async function saveGhostSecret(secret: string): Promise<void> {
  await SecureStore.setItemAsync(GHOST_SECRET_KEY, secret, {
    keychainService: 'gatekeeper',
    // On iOS/Android, this ensures the value is encrypted and only accessible on this device
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

/**
 * Retrieve the ghost_secret
 */
export async function getGhostSecret(): Promise<string | null> {
  return await SecureStore.getItemAsync(GHOST_SECRET_KEY, {
    keychainService: 'gatekeeper',
  });
}

/**
 * Check if biometrics are linked (ghost_secret exists)
 */
export async function isBiometricLinked(): Promise<boolean> {
  const secret = await getGhostSecret();
  return !!secret;
}

/**
 * Remove the link (delete ghost_secret)
 */
export async function unlinkBiometrics(): Promise<void> {
  await SecureStore.deleteItemAsync(GHOST_SECRET_KEY, {
    keychainService: 'gatekeeper',
  });
}
