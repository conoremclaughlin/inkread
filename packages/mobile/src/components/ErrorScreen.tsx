import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

/**
 * Full-screen error display — the same surface for a caught render error
 * (ErrorBoundary) and an uncaught/async error (the global handler). In a
 * RELEASE build there's no red-box, so this is how the stack becomes visible:
 * it's selectable, so you can screenshot it (untethered, no Mac) and send it on.
 */
export function ErrorScreen({
  message,
  stack,
  componentStack,
  context,
  onReset,
}: {
  message: string;
  stack?: string;
  componentStack?: string;
  context?: string;
  onReset?: () => void;
}) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Something crashed</Text>
      {context ? <Text style={styles.context}>{context}</Text> : null}
      <Text selectable style={styles.message}>
        {message}
      </Text>
      {stack ? (
        <Text selectable style={styles.stack}>
          {stack}
        </Text>
      ) : null}
      {componentStack ? (
        <Text selectable style={styles.stack}>
          {componentStack}
        </Text>
      ) : null}
      <Text style={styles.hint}>Screenshot this and send it to fix the crash.</Text>
      {onReset ? (
        <Pressable style={styles.button} onPress={onReset}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#1b1b1b' },
  content: { padding: 24, paddingTop: 72 },
  title: { color: '#ff6b5e', fontSize: 20, fontWeight: '700', marginBottom: 6 },
  context: { color: '#ffb4a0', fontSize: 12, marginBottom: 12 },
  message: { color: '#fff', fontSize: 15, marginBottom: 16 },
  stack: {
    color: '#c9c9c9',
    fontSize: 11,
    fontFamily: 'Courier',
    lineHeight: 16,
    marginBottom: 16,
  },
  hint: { color: '#8a8a8a', fontSize: 12, marginBottom: 16 },
  button: {
    alignSelf: 'flex-start',
    backgroundColor: '#8b5e3c',
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingVertical: 11,
  },
  buttonText: { color: '#fff', fontWeight: '700' },
});
