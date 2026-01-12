import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { supabase } from '../src/lib/supabase';
import { useAuth } from '../src/contexts/AuthContext';
import { issueAttestation, buildCallbackUrl, buildCancelledCallbackUrl } from '../src/lib/attestation';
import { isValidCallbackUrl, openUrl } from '../src/lib/linking';
import { authenticateWithBiometrics, getBiometricStatus } from '../src/lib/security';

/**
 * Auth Screen for Dawg Tag Integration
 *
 * This screen handles authentication requests from Dawg Tag.
 */
export default function AuthScreen() {
  const params = useLocalSearchParams<{ callback?: string }>();
  const callbackUrl = params.callback || null;
  const { session, loading: authLoading } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);

  const isValidCallback = isValidCallbackUrl(callbackUrl);

  useEffect(() => {
    async function checkBiometrics() {
      const status = await getBiometricStatus();
      setBiometricsAvailable(status.hasHardware && status.isEnrolled);
    }
    checkBiometrics();
  }, []);

  const handleBiometricLogin = async () => {
    if (!session) {
      setError('Please log in with email and password first to enable biometric login.');
      return;
    }

    try {
      const success = await authenticateWithBiometrics('Log in to Dawg Tag');
      if (success) {
        setLoading(true);
        const { attestation } = await issueAttestation(session);
        const finalUrl = buildCallbackUrl(callbackUrl!, attestation);
        setRedirecting(true);
        await openUrl(finalUrl);
      }
    } catch (err: any) {
      setError('Biometric authentication failed.');
      setLoading(false);
    }
  };

  const handlePasswordLogin = async () => {
    if (!isValidCallback || !callbackUrl) {
      setError('Invalid callback URL');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) throw authError;
      if (!data.session) throw new Error('Login failed');

      const { attestation } = await issueAttestation(data.session);
      const finalUrl = buildCallbackUrl(callbackUrl, attestation);
      setRedirecting(true);
      await openUrl(finalUrl);
    } catch (err: any) {
      setError(err.message || 'Login failed');
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    if (callbackUrl) {
      const cancelUrl = buildCancelledCallbackUrl(callbackUrl);
      setRedirecting(true);
      await openUrl(cancelUrl);
    }
  };

  if (authLoading) return null;

  if (!isValidCallback) {
    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.title}>GATEKEEPER</Text>
          <Text style={styles.subtitle}>Authentication Error</Text>
          <View style={styles.errorBox}><Text style={styles.errorText}>Invalid callback URL.</Text></View>
        </View>
      </View>
    );
  }

  if (redirecting) {
    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.title}>GATEKEEPER</Text>
          <Text style={styles.subtitle}>Redirecting to Dawg Tag...</Text>
          <ActivityIndicator size="large" color="#4CAF50" style={styles.spinner} />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.card}>
        <Text style={styles.title}>GATEKEEPER</Text>
        <Text style={styles.subtitle}>Continue to your app</Text>

        {error && (
          <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>
        )}

        {session && biometricsAvailable ? (
          <View style={styles.biometricSection}>
            <Text style={styles.description}>
              Signed in as <Text style={styles.emailText}>{session.user.email}</Text>
            </Text>
            <TouchableOpacity 
              style={[styles.button, styles.primaryButton, loading && styles.buttonDisabled]} 
              onPress={handleBiometricLogin}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Log in with Biometrics</Text>}
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.textLink} onPress={() => supabase.auth.signOut()}>
              <Text style={styles.textLinkText}>Use a different account</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.formSection}>
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="#666"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              editable={!loading}
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor="#666"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              editable={!loading}
            />
            <TouchableOpacity 
              style={[styles.button, styles.primaryButton, loading && styles.buttonDisabled]} 
              onPress={handlePasswordLogin}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign In</Text>}
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity style={[styles.button, styles.secondaryButton]} onPress={handleCancel} disabled={loading}>
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </TouchableOpacity>

        <Text style={styles.footerText}>
          Your credentials are verified by Gatekeeper.{'\n'}
          Your identity stays private with Dawg Tag.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a2e', padding: 20 },
  card: { width: '100%', maxWidth: 400, backgroundColor: '#252542', borderRadius: 12, padding: 24, alignItems: 'center' },
  title: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#888', marginBottom: 24 },
  description: { color: '#888', textAlign: 'center', marginBottom: 20 },
  emailText: { color: '#fff', fontWeight: 'bold' },
  input: { width: '100%', height: 50, backgroundColor: '#1a1a2e', borderRadius: 8, paddingHorizontal: 16, color: '#fff', fontSize: 16, marginBottom: 12, borderWidth: 1, borderColor: '#333' },
  button: { width: '100%', height: 50, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  primaryButton: { backgroundColor: '#4CAF50' },
  secondaryButton: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#666' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryButtonText: { color: '#888', fontSize: 16 },
  errorBox: { width: '100%', backgroundColor: 'rgba(244, 67, 54, 0.1)', borderRadius: 8, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(244, 67, 54, 0.3)' },
  errorText: { color: '#f44336', textAlign: 'center' },
  spinner: { marginTop: 24 },
  footerText: { color: '#666', fontSize: 12, textAlign: 'center', marginTop: 24, lineHeight: 18 },
  biometricSection: { width: '100%', alignItems: 'center' },
  formSection: { width: '100%' },
  textLink: { marginTop: 16 },
  textLinkText: { color: '#4CAF50', fontSize: 14 },
});
