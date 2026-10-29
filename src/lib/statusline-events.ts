import type { SessionMessageInfo } from "@opencode/client";
import { generationMetricsAfter } from "./statusline.js";
import { SubagentBadgeTracker } from "./subagent-badge.js";
import { familySyncTargets, isSubtreeSession, type SessionIdentity } from "./statusline-view-logic.js";

export type BadgeState = {
  count: number;
  speed?: number;
};

export type StatuslineEventsDependencies = {
  currentSessionID: () => string;
  subtree: () => readonly SessionIdentity[];
  messages: (sessionID: string) => readonly SessionMessageInfo[];
  syncMessages: (sessionID: string) => Promise<void>;
  clearQuotaCaches: () => void;
  resetQuota: () => void;
  refresh: () => void;
  setBadge: (state: BadgeState) => void;
};

export class StatuslineEvents {
  private readonly tracker = new SubagentBadgeTracker();
  private readonly familySynced = new Set<string>();
  private badge: BadgeState = { count: 0 };
  private version = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly dependencies: StatuslineEventsDependencies) {}

  start(sessionID: string): void {
    if (!this.inSubtree(sessionID)) return;
    this.tracker.start(sessionID, this.dependencies.messages(sessionID).at(-1)?.id);
    this.version += 1;
  }

  success(sessionID: string): void {
    const current = sessionID === this.dependencies.currentSessionID();
    if (!current && !this.inSubtree(sessionID)) return;
    this.dependencies.refresh();
    if (current) return;
    const finished = this.tracker.finish(sessionID);
    if (!finished.counted) return;

    this.setBadge({ count: this.badge.count + 1 });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.tracker.clearDone();
      this.setBadge({ count: 0 });
    }, 8_000);

    if (finished.afterID === undefined) return;
    const version = ++this.version;
    const speed = () =>
      generationMetricsAfter(this.dependencies.messages(sessionID), finished.afterID!)
        ?.tokensPerSecond;

    const immediate = speed();
    if (immediate !== undefined) {
      this.setBadge({ ...this.badge, speed: immediate });
      return;
    }

    void this.dependencies
      .syncMessages(sessionID)
      .then(() => {
        if (version !== this.version) return;
        const synced = speed();
        if (synced !== undefined) this.setBadge({ ...this.badge, speed: synced });
      })
      .catch(() => undefined);
  }

  fail(sessionID: string): void {
    const current = sessionID === this.dependencies.currentSessionID();
    if (!current && !this.inSubtree(sessionID)) return;
    if (!current) this.tracker.fail(sessionID);
    this.dependencies.refresh();
  }

  credentialChanged(): void {
    this.dependencies.clearQuotaCaches();
    this.dependencies.resetQuota();
    this.dependencies.refresh();
  }

  syncFamily(sessions: readonly SessionIdentity[]): void {
    const targets = familySyncTargets({
      sessions,
      currentSessionID: this.dependencies.currentSessionID(),
      synced: this.familySynced,
      messages: this.dependencies.messages
    });
    for (const sessionID of targets) {
      this.familySynced.add(sessionID);
      void this.dependencies
        .syncMessages(sessionID)
        .then(() => this.dependencies.refresh())
        .catch(() => undefined);
    }
  }

  resetSession(): void {
    this.version += 1;
    this.tracker.reset();
    this.familySynced.clear();
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.setBadge({ count: 0 });
  }

  dispose(): void {
    this.resetSession();
  }

  private inSubtree(sessionID: string): boolean {
    return isSubtreeSession(
      sessionID,
      this.dependencies.currentSessionID(),
      this.dependencies.subtree()
    );
  }

  private setBadge(state: BadgeState): void {
    this.badge = state;
    this.dependencies.setBadge(state);
  }
}
