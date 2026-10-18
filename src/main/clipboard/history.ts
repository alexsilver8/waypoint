import { randomUUID } from 'node:crypto';
import { debounce, readJsonFile, writeJsonFile } from '../json-file';

export interface ClipboardEntry {
  id: string;
  text: string;
  /** Epoch milliseconds. */
  copiedAt: number;
}

/** What the history needs from the system clipboard; injected so it can be tested without Electron. */
export interface ClipboardSource {
  readText(): Promise<string>;
  /** Whether the app that copied the text asked for it not to be recorded (e.g. a password manager). */
  isConcealed(): Promise<boolean>;
}

const POLL_INTERVAL_MS = 750;
const MAX_ENTRY_LENGTH = 200_000;

/** Records text copied anywhere on the system and keeps the most recent entries. */
export class ClipboardHistory {
  private items: ClipboardEntry[];
  private lastSeen: string | undefined;
  private timer: NodeJS.Timeout | undefined;
  private polling = false;
  private readonly save = debounce(() => this.persist(), 1000);

  constructor(
    private readonly path: string,
    private readonly source: ClipboardSource,
    private maxItems: number,
    private readonly now: () => number = Date.now,
  ) {
    this.items = this.load();
  }

  entries(): readonly ClipboardEntry[] {
    return this.items;
  }

  async start(): Promise<void> {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
    // Don't record whatever was already on the clipboard before we started.
    this.lastSeen = await this.safeRead();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  get running(): boolean {
    return this.timer !== undefined;
  }

  setMaxItems(maxItems: number): void {
    this.maxItems = maxItems;
    this.trim();
  }

  /** Checks the clipboard once; called on an interval while running. */
  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const text = await this.safeRead();
      if (text === undefined || text === this.lastSeen) return;
      this.lastSeen = text;
      if (await this.source.isConcealed().catch(() => false)) return;
      this.add(text);
    } finally {
      this.polling = false;
    }
  }

  /** Takes `text` as seen already, so Waypoint putting it on the clipboard doesn't add it. */
  ignore(text: string): void {
    this.lastSeen = text;
  }

  add(text: string): void {
    if (!text.trim() || text.length > MAX_ENTRY_LENGTH) return;
    this.items = [{ id: randomUUID(), text, copiedAt: this.now() }, ...this.items.filter((item) => item.text !== text)];
    this.trim();
    this.save();
  }

  remove(id: string): void {
    this.items = this.items.filter((item) => item.id !== id);
    this.save();
  }

  clear(): void {
    this.items = [];
    this.save();
  }

  flush(): void {
    this.save.flush();
  }

  private trim(): void {
    if (this.items.length > this.maxItems) this.items = this.items.slice(0, this.maxItems);
  }

  private async safeRead(): Promise<string | undefined> {
    try {
      return await this.source.readText();
    } catch {
      return undefined;
    }
  }

  private load(): ClipboardEntry[] {
    try {
      const data = readJsonFile(this.path);
      if (!Array.isArray(data)) return [];
      return data.filter(
        (item): item is ClipboardEntry =>
          typeof item?.id === 'string' && typeof item.text === 'string' && typeof item.copiedAt === 'number',
      );
    } catch {
      return [];
    }
  }

  private persist(): void {
    try {
      writeJsonFile(this.path, this.items);
    } catch (error) {
      console.error('[clipboard] Could not save history:', error);
    }
  }
}
