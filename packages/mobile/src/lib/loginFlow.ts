/**
 * Orchestrates a successful sign-in. Kept out of the screen so it's unit-
 * testable and so the ordering guarantee is explicit: **navigate as soon as
 * the credentials are accepted; never block entry on the library sync.** A
 * first pull can take tens of seconds (hundreds of chapters), and making the
 * spinner wait on it looks like a hang. The Library re-syncs on focus anyway.
 */
export interface SignInDeps {
  login: (email: string, password: string) => Promise<void>;
  onAuthed: () => void;
  sync: () => Promise<void>;
  navigate: () => void;
}

export async function performSignIn(
  email: string,
  password: string,
  deps: SignInDeps,
): Promise<void> {
  await deps.login(email, password);
  deps.onAuthed();
  // Fire-and-forget — entry must not wait on a full library pull.
  void deps.sync().catch(() => undefined);
  deps.navigate();
}
