import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';
import { login } from '../lib/api';
import { useAuth } from '../lib/authContext';
import { syncNow } from '../lib/sync';
import { colors } from '../ui/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export function LoginScreen({ navigation }: Props) {
  const { setAuthed } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  // Reachable as a modal from the Library (you already have local books) vs.
  // the first screen on a fresh device — only the former offers "read offline".
  const canReadOffline = navigation.canGoBack();

  const submit = async () => {
    setPending(true);
    setError(undefined);
    try {
      await login(email.trim(), password);
      setAuthed(true);
      await syncNow(true).catch(() => undefined);
      if (navigation.canGoBack()) navigation.goBack();
      else navigation.replace('Library');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.screen}
    >
      <View style={styles.card}>
        <Text style={styles.title}>inkread</Text>
        <Text style={styles.subtitle}>Sign in to sync your library across devices.</Text>
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.inkSoft}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <View style={styles.passwordRow}>
          <TextInput
            style={styles.passwordInput}
            placeholder="Password"
            placeholderTextColor={colors.inkSoft}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            value={password}
            onChangeText={setPassword}
          />
          <Pressable hitSlop={8} onPress={() => setShowPassword((v) => !v)}>
            <Text style={styles.reveal}>{showPassword ? 'Hide' : 'Show'}</Text>
          </Pressable>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable style={styles.button} onPress={() => void submit()} disabled={pending}>
          {pending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Sign in</Text>
          )}
        </Pressable>
        {canReadOffline ? (
          <Pressable hitSlop={8} onPress={() => navigation.goBack()} disabled={pending}>
            <Text style={styles.secondary}>Not now — keep reading offline</Text>
          </Pressable>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: 24 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  title: { fontSize: 30, fontWeight: '700', color: colors.ink },
  subtitle: { marginTop: 4, color: colors.inkSoft },
  input: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: '#fff',
  },
  passwordRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: '#fff',
    paddingRight: 12,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.ink,
  },
  reveal: { color: colors.accent, fontWeight: '600', fontSize: 14 },
  error: { marginTop: 10, color: colors.danger },
  button: {
    marginTop: 18,
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondary: { marginTop: 16, textAlign: 'center', color: colors.inkSoft, fontWeight: '600' },
});
