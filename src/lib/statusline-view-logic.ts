export type SessionIdentity = {
  id: string;
};

export function isSubtreeSession(
  sessionID: string,
  currentSessionID: string,
  subtree: readonly SessionIdentity[]
): boolean {
  return sessionID !== currentSessionID && subtree.some((item) => item.id === sessionID);
}

export function familySyncTargets(input: {
  sessions: readonly SessionIdentity[];
  currentSessionID: string;
  synced: ReadonlySet<string>;
  messages: (sessionID: string) => readonly unknown[];
}): string[] {
  return input.sessions
    .filter((item) => item.id !== input.currentSessionID)
    .filter((item) => input.messages(item.id).length === 0)
    .filter((item) => !input.synced.has(item.id))
    .map((item) => item.id);
}
