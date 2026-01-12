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
  last_used_at: string | null;
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
    // Only load if we have a valid session
    if (session?.access_token) {
      loadPasskeys();
    } else {
      setLoadingKeys(false);
    }
  }, [session]);

  const loadPasskeys = async () => {
    try {
      // Ensure we have the most up to date session
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      
      if (!currentSession?.access_token) {
        setLoadingKeys(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke('passkey-register', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${currentSession.access_token}`
        }
      });
      
      if (error) {
        // Log the specific error from the function
        console.warn('[Passkey-List] Function error:', error);
        setPasskeys([]);
      } else {
        setPasskeys(data?.passkeys || []);
      }
    } catch (err: any) {
      console.error('[Passkey-List] Exception:', err.message);
    } finally {
      setLoadingKeys(false);
    }
  };

  const handleLinkDevice = async () => {
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    
    if (!currentSession?.access_token) {
      Alert.alert('Error', 'Please log in again to register hardware.');
      return;
    }

    setLinkingDevice(true);
    try {
      const result = await registerPasskey(user?.email || '');
      if (result.success) {
        Alert.alert('Success', 'Hardware key registered.');
        loadPasskeys();
      } else {
        Alert.alert('Error', result.error || 'Registration failed');
      }
    } catch (err: any) {
      Alert.alert('Error', 'Hardware communication failed.');
    } finally {
      setLinkingDevice(false);
    }
  };

  const handleDeletePasskey = (id: string, name: string) => {
    Alert.alert(
      'Remove Key?',
      `Delete link for ${name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive', 
          onPress: async () => {
            const { data: { session: currentSession } } = await supabase.auth.getSession();
            await supabase.functions.invoke('passkey-register', {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${currentSession?.access_token}` },
              body: { passkey_id: id }
            });
            loadPasskeys();
          }
        }
      ]
    );
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
        <Text style={styles.description}>Link your device to the vault.</Text>

        {loadingKeys ? (
          <ActivityIndicator color="#4CAF50" />
        ) : (
          <View style={styles.keyList}>
            {passkeys.map(key => (
              <View key={key.id} style={styles.keyItem}>
                <View>
                  <Text style={styles.keyName}>{key.device_name}</Text>
                  <Text style={styles.keyMeta}>{new Date(key.created_at).toLocaleDateString()}</Text>
                </View>
                <TouchableOpacity onPress={() => handleDeletePasskey(key.id, key.device_name)}>
                  <Text style={styles.deleteLink}>Delete</Text>
                </TouchableOpacity>
              </View>
            ))}
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
        <Text style={styles.cardTitle}>Master Password</Text>
        <View style={styles.field}>
          <Text style={styles.label}>New Password</Text>
          <TextInput style={styles.input} value={newPassword} onChangeText={setNewPassword} secureTextEntry />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Confirm Password</Text>
          <TextInput style={styles.input} value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry />
        </View>
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
  keyItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#333' },
  keyName: { color: '#fff', fontSize: 15, fontWeight: '600' },
  keyMeta: { color: '#666', fontSize: 12 },
  deleteLink: { color: '#f44336', fontSize: 13 },
  linkButton: { backgroundColor: '#4CAF50', borderRadius: 8, padding: 16, alignItems: 'center' },
  linkButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  field: { marginBottom: 16 },
  label: { fontSize: 13, color: '#888', marginBottom: 8 },
  input: { backgroundColor: '#1a1a2e', borderRadius: 8, padding: 12, color: '#fff', fontSize: 16, borderWidth: 1, borderColor: '#333' },
  saveButton: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#4CAF50', borderRadius: 8, padding: 16, alignItems: 'center', marginTop: 8 },
  saveButtonText: { color: '#4CAF50', fontSize: 16, fontWeight: '600' },
  buttonDisabled: { opacity: 0.6 },
});
