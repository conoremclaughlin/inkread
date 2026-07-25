import { useEffect, useMemo, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import type { RootStackParamList } from './src/navigation';
import { loadSession, onSessionExpired } from './src/lib/api';
import { AuthContext } from './src/lib/authContext';
import { getClientStore } from './src/store/clientStore';
import { syncNow } from './src/lib/sync';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { NotesScreen } from './src/screens/NotesScreen';
import { ReaderScreen } from './src/screens/ReaderScreen';
import { colors } from './src/ui/theme';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [authed, setAuthed] = useState<boolean>();
  const [hasLocalBooks, setHasLocalBooks] = useState<boolean>();

  useEffect(() => {
    void loadSession().then((ok) => {
      setAuthed(ok);
      if (ok) void syncNow().catch(() => undefined);
    });
    // Whether there's anything to read on-device decides the entry screen: books
    // present → straight to the Library even signed out; empty → Login, since a
    // fresh device has nothing local and needs a session to fetch the library.
    void getClientStore()
      .then((store) => store.listBooks())
      .then((books) => setHasLocalBooks(books.length > 0))
      .catch(() => setHasLocalBooks(false));
    // A dead session no longer ejects to Login — it just flips `authed`, so the
    // Library keeps serving on-device books and shows a "sign in to sync" hint.
    // Being locked out of your own downloaded books by an expired token is the
    // trap we're removing.
    onSessionExpired(() => setAuthed(false));
  }, []);

  const authValue = useMemo(
    () => ({ authed: authed ?? false, setAuthed }),
    [authed],
  );

  if (authed === undefined || hasLocalBooks === undefined) return null;

  return (
    <AuthContext.Provider value={authValue}>
      <NavigationContainer>
        <StatusBar style="dark" />
        <Stack.Navigator
          initialRouteName={authed || hasLocalBooks ? 'Library' : 'Login'}
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
    </AuthContext.Provider>
  );
}
