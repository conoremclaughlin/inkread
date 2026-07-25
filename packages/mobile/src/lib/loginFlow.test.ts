import { describe, expect, it, vi } from 'vitest';
import { performSignIn } from './loginFlow';

describe('performSignIn', () => {
  it('navigates immediately after auth — never waits on the library sync', async () => {
    const order: string[] = [];
    // A sync that never resolves stands in for a slow first pull (hundreds of
    // chapters). Entry must not hang on it — the bug was a ~45s spinner.
    const neverResolves = new Promise<void>(() => undefined);

    await performSignIn('me@example.com', 'pw', {
      login: async () => {
        order.push('login');
      },
      onAuthed: () => order.push('authed'),
      sync: () => {
        order.push('sync-started');
        return neverResolves;
      },
      navigate: () => order.push('navigate'),
    });

    // performSignIn resolved even though sync is still pending, and navigate ran.
    expect(order).toEqual(['login', 'authed', 'sync-started', 'navigate']);
  });

  it('does not mark authed, sync, or navigate when the credentials are rejected', async () => {
    const onAuthed = vi.fn();
    const sync = vi.fn(async () => undefined);
    const navigate = vi.fn();

    await expect(
      performSignIn('me@example.com', 'wrong', {
        login: async () => {
          throw new Error('Incorrect email or password.');
        },
        onAuthed,
        sync,
        navigate,
      }),
    ).rejects.toThrow('Incorrect email or password.');

    expect(onAuthed).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('swallows a sync failure — a failed background pull must not fail sign-in', async () => {
    const navigate = vi.fn();
    await expect(
      performSignIn('me@example.com', 'pw', {
        login: async () => undefined,
        onAuthed: () => undefined,
        sync: async () => {
          throw new Error('offline');
        },
        navigate,
      }),
    ).resolves.toBeUndefined();
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
