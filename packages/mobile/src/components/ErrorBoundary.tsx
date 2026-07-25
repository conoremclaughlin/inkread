import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

/**
 * Catches render crashes and shows the error on-screen — including in RELEASE
 * builds, where React Native has no red-box and an uncaught error otherwise
 * leaves a blank white screen with no clue what happened. That's the trap Conor
 * hit tapping a book offline: it "crashed to a blank page" with no trace.
 *
 * So a `ios:release` build (bundled JS, runs untethered — no Mac, no Wi-Fi) now
 * surfaces the message + stack + component stack you'd otherwise only see over a
 * dev connection. "Try again" remounts the tree so a transient crash recovers.
 *
 * Note: this catches errors thrown during React render/lifecycle. Async
 * rejections (e.g. a failed fetch in an effect) are handled where they happen —
 * see ReaderScreen's load states.
 */
interface Props {
  children: ReactNode;
}

interface State {
  error?: Error;
  componentStack?: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Logged too, so `npx react-native log-ios` / device console keep a copy.
    console.error('[inkread] uncaught render error:', error, info.componentStack);
    this.setState({ error, componentStack: info.componentStack ?? undefined });
  }

  private reset = (): void => this.setState({ error: undefined, componentStack: undefined });

  render(): ReactNode {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Something crashed</Text>
        <Text selectable style={styles.message}>
          {error.message || String(error)}
        </Text>
        {error.stack ? (
          <Text selectable style={styles.stack}>
            {error.stack}
          </Text>
        ) : null}
        {componentStack ? (
          <Text selectable style={styles.stack}>
            {componentStack}
          </Text>
        ) : null}
        <Pressable style={styles.button} onPress={this.reset}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </ScrollView>
    );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#1b1b1b' },
  content: { padding: 24, paddingTop: 72 },
  title: { color: '#ff6b5e', fontSize: 20, fontWeight: '700', marginBottom: 12 },
  message: { color: '#fff', fontSize: 15, marginBottom: 16 },
  stack: {
    color: '#c9c9c9',
    fontSize: 11,
    fontFamily: 'Courier',
    lineHeight: 16,
    marginBottom: 16,
  },
  button: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#8b5e3c',
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingVertical: 11,
  },
  buttonText: { color: '#fff', fontWeight: '700' },
});
