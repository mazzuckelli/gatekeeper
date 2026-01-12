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
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/contexts/AuthContext';
import { 
  checkBiometricStatus, 
  authenticateWithBiometrics, 
  isBiometricEnabled,
  getCredentials
} from '../src/lib/security';

export default function LoginScreen() {
  const router = useRouter();
  const { signIn } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);

  useEffect(() => {
    async function init() {
      const [{ hasHardware, isEnrolled }, enabled] = await Promise.all([
        checkBiometricStatus(),
        isBiometricEnabled()
      ]);
      setBiometricsAvailable(hasHardware && isEnrolled && enabled);
    }
    init();
  }, []);

  const handleLogin = async () => {
    if (!email || !password) {
      setError('Please enter email and password');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await signIn(email, password);
      router.replace('/(tabs)');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleBiometricLogin = async () => {
    const success = await authenticateWithBiometrics();
    if (success) {
      setLoading(true);
      setError(null);
      try {
        const creds = await getCredentials();
        if (creds) {
          await signIn(creds.email, creds.password);
          router.replace('/(tabs)');
        } else {
          setError('Biometric credentials missing. Please log in with password.');
        }
      } catch (err: any) {
        setError(err.message || 'Biometric login failed');
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.card}>
        <Text style={styles.title}>GATEKEEPER</Text>
        <Text style={styles.subtitle}>Sign in to your account</Text>

        {error && (
          <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>
        )}

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

        <TouchableOpacity style={[styles.button, styles.primaryButton, loading && styles.buttonDisabled]} onPress={handleLogin} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign In</Text>}
        </TouchableOpacity>

        {biometricsAvailable && (
          <TouchableOpacity style={[styles.button, styles.biometricButton]} onPress={handleBiometricLogin} disabled={loading}>
            <Text style={styles.biometricButtonText}>Login with Biometrics</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.linkButton} onPress={() => router.push('/register')} disabled={loading}>
          <Text style={styles.linkText}>Don't have an account? <Text style={styles.linkTextBold}>Sign up</Text></Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a2e', padding: 20 },
  card: { width: '100%', maxWidth: 400, backgroundColor: '#252542', borderRadius: 12, padding: 24, alignItems: 'center' },
  title: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#888', marginBottom: 24 },
  input: { width: '100%', height: 50, backgroundColor: '#1a1a2e', borderRadius: 8, paddingHorizontal: 16, color: '#fff', fontSize: 16, marginBottom: 12, borderWidth: 1, borderColor: '#333' },
  button: { width: '100%', height: 50, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  primaryButton: { backgroundColor: '#4CAF50' },
  biometricButton: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#4CAF50', marginTop: 12 },
  biometricButtonText: { color: '#4CAF50', fontSize: 16, fontWeight: '600' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  errorBox: { width: '100%', backgroundColor: 'rgba(244, 67, 54, 0.1)', borderRadius: 8, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(244, 67, 54, 0.3)' },
  errorText: { color: '#f44336', textAlign: 'center' },
  linkButton: { marginTop: 24 },
  linkText: { color: '#888', fontSize: 14 },
  linkTextBold: { color: '#4CAF50', fontWeight: '600' },
});
