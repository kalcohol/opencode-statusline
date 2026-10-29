export type SubagentFinish = {
  counted: boolean;
  afterID?: string;
};

export class SubagentBadgeTracker {
  private readonly starts = new Map<string, string | undefined>();
  private readonly done = new Set<string>();

  start(sessionID: string, lastMessageID: string | undefined): void {
    this.starts.set(sessionID, lastMessageID);
    this.done.delete(sessionID);
  }

  finish(sessionID: string): SubagentFinish {
    if (this.done.has(sessionID)) return { counted: false };
    const afterID = this.starts.get(sessionID);
    this.starts.delete(sessionID);
    this.done.add(sessionID);
    return { counted: true, afterID };
  }

  fail(sessionID: string): void {
    this.starts.delete(sessionID);
    this.done.add(sessionID);
  }

  clearDone(): void {
    this.done.clear();
  }

  reset(): void {
    this.starts.clear();
    this.done.clear();
  }
}
