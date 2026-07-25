import { createContext, useContext } from 'react';

/**
 * Whether a server session exists (tokens are cached). It gates *server*
 * features — sync, import, downloading cloud books — but never access to
 * books already on the device. `authed` false with local content is a normal,
 * fully-usable state (reading offline / signed out), not a locked door.
 */
export interface AuthState {
  authed: boolean;
  setAuthed: (value: boolean) => void;
}

export const AuthContext = createContext<AuthState>({
  authed: false,
  setAuthed: () => undefined,
});

export const useAuth = (): AuthState => useContext(AuthContext);
