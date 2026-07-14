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
import { login } from '../lib/api';
import { syncNow } from '../lib/sync';
import { colors } from '../ui/theme';

export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const submit = async () => {
    setPending(true);
    setError(undefined);
    try {
      await login(email.trim(), password);
      await syncNow(true).catch(() => undefined);
      onLoggedIn();
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
        <Text style={styles.subtitle}>Log in to sync your library.</Text>
        <TextInput
          style={styles.input}
          placeholder="Email"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable style={styles.button} onPress={() => void submit()} disabled={pending}>
          {pending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Log in</Text>
          )}
        </Pressable>
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
  error: { marginTop: 10, color: colors.danger },
  button: {
    marginTop: 18,
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
