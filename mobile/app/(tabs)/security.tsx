import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { useAuth } from '../../src/contexts/AuthContext';
import { supabase } from '../../src/lib/supabase';
import { registerPasskey } from '../../src/lib/passkey';

interface PasskeyInfo {
  id: string;
  device_name: string;
  created_at: string;
}

export default function SecurityScreen() {
  const { user, session } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  
  const [passkeys, setPasskeys] = useState<PasskeyInfo[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [linkingDevice, setLinkingDevice] = useState(false);

  useEffect(() => {
    loadPasskeys();
  }, []);

  const loadPasskeys = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        console.warn('[Security] No active session');
        setLoadingKeys(false);
        return;
      }

      console.log('[Security] Calling passkey-register with token:', session.access_token.substring(0, 20) + '...');

      // Use direct fetch since supabase.functions.invoke doesn't pass Authorization header correctly
      const functionUrl = `${process.env.EXPO_PUBLIC_GATEKEEPER_URL}/functions/v1/passkey-register`;
      const fetchResponse = await fetch(functionUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': process.env.EXPO_PUBLIC_GATEKEEPER_PUBLISHABLE_KEY || '',
          'Content-Type': 'application/json',
        },
      });

      const response = {
        data: fetchResponse.ok ? await fetchResponse.json() : null,
        error: fetchResponse.ok ? null : new Error(`HTTP ${fetchResponse.status}`),
      };
      
      if (response.error) {
        console.warn('[Security] Function returned error:', response.error);
        console.warn('[Security] Error context:', JSON.stringify(response.error, null, 2));
        console.warn('[Security] Response data:', response.data);
        setPasskeys([]);
      } else {
        setPasskeys(response.data?.passkeys || []);
      }
    } catch (err: any) {
      console.error('[Security] Fetch Exception:', err.message);
    } finally {
      setLoadingKeys(false);
    }
  };

  const handleLinkDevice = async () => {
    setLinkingDevice(true);
    try {
      const result = await registerPasskey(user?.email || '');
      if (result.success) {
        Alert.alert('Success', 'Device linked.');
        loadPasskeys();
      } else {
        Alert.alert('Registration Error', result.error);
      }
    } catch (err: any) {
      Alert.alert('Error', 'Hardware communication failed.');
    } finally {
      setLinkingDevice(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'Passwords mismatch');
      return;
    }
    setChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      Alert.alert('Success', 'Password updated');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Hardware Security</Text>
        <Text style={styles.description}>Manage your physical device keys.</Text>

        {loadingKeys ? (
          <ActivityIndicator color="#4CAF50" style={{ marginVertical: 10 }} />
        ) : (
          <View style={styles.keyList}>
            {passkeys.map(key => (
              <View key={key.id} style={styles.keyItem}>
                <Text style={styles.keyName}>{key.device_name}</Text>
                <Text style={styles.keyMeta}>{new Date(key.created_at).toLocaleDateString()}</Text>
              </View>
            ))}
            {passkeys.length === 0 && <Text style={styles.emptyText}>No devices linked yet.</Text>}
          </View>
        )}

        <TouchableOpacity 
          style={[styles.linkButton, linkingDevice && styles.buttonDisabled]} 
          onPress={handleLinkDevice}
          disabled={linkingDevice}
        >
          {linkingDevice ? <ActivityIndicator color="#fff" /> : <Text style={styles.linkButtonText}>Link This Device</Text>}
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Change Password</Text>
        <TextInput style={styles.input} value={newPassword} onChangeText={setNewPassword} placeholder="New Password" secureTextEntry />
        <TextInput style={styles.input} value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Confirm" secureTextEntry />
        <TouchableOpacity style={styles.saveButton} onPress={handleChangePassword} disabled={changingPassword}>
          <Text style={styles.saveButtonText}>Update Password</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 16 },
  card: { backgroundColor: '#252542', borderRadius: 12, padding: 20, marginBottom: 16 },
  cardTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 16 },
  description: { fontSize: 14, color: '#888', marginBottom: 20 },
  keyList: { marginBottom: 20 },
  keyItem: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#333' },
  keyName: { color: '#fff', fontSize: 15 },
  keyMeta: { color: '#666', fontSize: 12 },
  emptyText: { color: '#666', fontStyle: 'italic', textAlign: 'center' },
  linkButton: { backgroundColor: '#4CAF50', borderRadius: 8, padding: 16, alignItems: 'center' },
  linkButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  input: { backgroundColor: '#1a1a2e', borderRadius: 8, padding: 12, color: '#fff', marginBottom: 12, borderWidth: 1, borderColor: '#333' },
  saveButton: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#4CAF50', borderRadius: 8, padding: 16, alignItems: 'center' },
  saveButtonText: { color: '#4CAF50', fontSize: 16 },
  buttonDisabled: { opacity: 0.6 },
});
