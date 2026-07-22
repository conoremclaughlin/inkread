import { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import type { RootStackParamList } from './src/navigation';
import { loadSession, onSessionExpired } from './src/lib/api';
import { syncNow } from './src/lib/sync';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { NotesScreen } from './src/screens/NotesScreen';
import { ReaderScreen } from './src/screens/ReaderScreen';
import { colors } from './src/ui/theme';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [authed, setAuthed] = useState<boolean>();

  useEffect(() => {
    void loadSession().then((ok) => {
      setAuthed(ok);
      if (ok) void syncNow().catch(() => undefined);
    });
    // The server rejected our refresh token: sync is dead until the user
    // signs in again. Return to Login rather than silently serving an
    // ever-staler cache with a broken sync loop.
    onSessionExpired(() => setAuthed(false));
  }, []);

  if (authed === undefined) return null;
  if (!authed) {
    return (
      <>
        <StatusBar style="dark" />
        <LoginScreen onLoggedIn={() => setAuthed(true)} />
      </>
    );
  }

  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.ink,
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="Library" component={LibraryScreen} options={{ title: 'inkread' }} />
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
  );
}
