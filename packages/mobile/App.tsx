import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import type { RootStackParamList } from './src/navigation';
import { loadSession, onSessionExpired } from './src/lib/api';
import { AuthContext } from './src/lib/authContext';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { ErrorScreen } from './src/components/ErrorScreen';
import { installGlobalErrorHandler, type RecordedError } from './src/lib/errorLog';
import { syncNow } from './src/lib/sync';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { NotesScreen } from './src/screens/NotesScreen';
import { ReaderScreen } from './src/screens/ReaderScreen';
import { DiscoverScreen } from './src/screens/DiscoverScreen';
import { SeriesScreen } from './src/screens/SeriesScreen';
import { colors } from './src/ui/theme';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [authed, setAuthed] = useState<boolean>();
  const [fatal, setFatal] = useState<RecordedError>();

  useEffect(() => {
    // Uncaught/async errors don't reach the ErrorBoundary; surface them here so
    // a release build shows the stack (to screenshot) instead of a blank page.
    installGlobalErrorHandler(setFatal);
    void loadSession().then((ok) => {
      setAuthed(ok);
      if (ok) void syncNow().catch(() => undefined);
    });
    // A dead session never ejects — it just flips `authed`, so the Library keeps
    // serving on-device books and shows a "sign in to sync" hint.
    onSessionExpired(() => setAuthed(false));
  }, []);

  const authValue = useMemo(() => ({ authed: authed ?? false, setAuthed }), [authed]);

  if (fatal) {
    return (
      <ErrorScreen
        context={fatal.context}
        message={fatal.message}
        stack={fatal.stack}
        onReset={() => setFatal(undefined)}
      />
    );
  }

  // Brief splash only until we know the auth state — avoids flashing the
  // signed-out banner before loadSession resolves.
  if (authed === undefined) return null;

  return (
    <ErrorBoundary>
      <AuthContext.Provider value={authValue}>
        <NavigationContainer>
        <StatusBar style="dark" />
        {/* Always enter the Library — reading is local-first, so the app is
            never walled behind a login. Sign-in is an opt-in screen reached
            from the Library, needed only for server actions (sync, import,
            downloading a cloud-only book). */}
        <Stack.Navigator
          initialRouteName="Library"
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.ink,
            headerShadowVisible: false,
          }}
        >
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{
              headerShown: false,
              presentation: 'fullScreenModal',
              animation: 'slide_from_bottom',
            }}
          />
          <Stack.Screen
            name="Library"
            component={LibraryScreen}
            options={({ navigation }) => ({
              title: 'inkread',
              headerRight: () => (
                <Pressable hitSlop={12} onPress={() => navigation.navigate('Discover')}>
                  <Text style={{ color: colors.accent, fontWeight: '600', fontSize: 15 }}>
                    Discover
                  </Text>
                </Pressable>
              ),
            })}
          />
          <Stack.Screen name="Discover" component={DiscoverScreen} options={{ title: 'Discover' }} />
          <Stack.Screen
            name="Series"
            component={SeriesScreen}
            options={({ route }) => ({ title: route.params.title })}
          />
          <Stack.Screen
            name="Reader"
            component={ReaderScreen}
            options={{
              headerShown: false,
              presentation: 'fullScreenModal',
              animation: 'slide_from_bottom',
            }}
          />
          <Stack.Screen
            name="Notes"
            component={NotesScreen}
            options={({ route }) => ({ title: `Notes · ${route.params.title}` })}
          />
        </Stack.Navigator>
      </NavigationContainer>
      </AuthContext.Provider>
    </ErrorBoundary>
  );
}
