import Dexie, { type Table } from 'dexie';

/**
 * Local-first answer store (Innovation 5.3). Every change is written to IndexedDB *before* the network,
 * so a dropped connection, refresh or crashed tab never loses work. The sync engine flushes the outbox
 * and only deletes entries the server acknowledged (by seq).
 */
export interface OutboxItem {
  key: string; // `${attemptId}:${questionId}`
  attemptId: string;
  questionId: string;
  response?: unknown;
  flagged?: boolean;
  visited?: boolean;
  timeSpentMs?: number;
  seq: number;
  offline?: boolean;
  claimedAt?: number;
}
export interface Snapshot {
  attemptId: string;
  data: unknown;
  savedAt: number;
}
export interface PendingEvent {
  id?: number;
  attemptId: string;
  type: string;
  at: number;
  details?: string;
}

class ExamDB extends Dexie {
  outbox!: Table<OutboxItem, string>;
  snapshots!: Table<Snapshot, string>;
  events!: Table<PendingEvent, number>;
  constructor() {
    super('examguard');
    this.version(1).stores({ outbox: 'key, attemptId', snapshots: 'attemptId', events: '++id, attemptId' });
  }
}
export const db = new ExamDB();

/** Merge a change into the pending item for that question (latest value wins, seq strictly increases). */
export async function queueAnswer(item: Omit<OutboxItem, 'key'>) {
  const key = `${item.attemptId}:${item.questionId}`;
  try {
    await db.transaction('rw', db.outbox, async () => {
      const prev = await db.outbox.get(key);
      await db.outbox.put({ ...(prev ?? {}), ...item, key, offline: (prev?.offline ?? false) || !!item.offline, claimedAt: item.claimedAt ?? prev?.claimedAt });
    });
  } catch {
    memoryOutbox.set(key, { ...(memoryOutbox.get(key) ?? {}), ...item, key });
  }
}
// fallback when IndexedDB is unavailable (private mode in some browsers)
const memoryOutbox = new Map<string, OutboxItem>();

export async function pendingFor(attemptId: string): Promise<OutboxItem[]> {
  try {
    return [...(await db.outbox.where('attemptId').equals(attemptId).toArray()), ...[...memoryOutbox.values()].filter((x) => x.attemptId === attemptId)];
  } catch {
    return [...memoryOutbox.values()].filter((x) => x.attemptId === attemptId);
  }
}

export async function acknowledge(attemptId: string, acks: { questionId: string; seq: number }[]) {
  for (const a of acks) {
    const key = `${attemptId}:${a.questionId}`;
    try {
      const cur = await db.outbox.get(key);
      if (cur && cur.seq <= a.seq) await db.outbox.delete(key);
    } catch {
      /* ignore */
    }
    const m = memoryOutbox.get(key);
    if (m && m.seq <= a.seq) memoryOutbox.delete(key);
  }
}
/** Drop rejected items — but only the version that was sent (a newer edit made meanwhile is kept). */
export async function dropRejected(attemptId: string, rejected: { questionId: string; seq: number }[]) {
  for (const r of rejected) {
    const key = `${attemptId}:${r.questionId}`;
    try {
      const cur = await db.outbox.get(key);
      if (cur && cur.seq <= r.seq) await db.outbox.delete(key);
    } catch {
      /* ignore */
    }
    const m = memoryOutbox.get(key);
    if (m && m.seq <= r.seq) memoryOutbox.delete(key);
  }
}

/** After a network failure, everything still queued counts as offline work (eligible for the post-deadline merge). */
export async function markPendingOffline(attemptId: string) {
  try {
    await db.outbox.where('attemptId').equals(attemptId).modify({ offline: true });
  } catch {
    memoryOutbox.forEach((v) => v.attemptId === attemptId && (v.offline = true));
  }
}

export const saveSnapshot = (attemptId: string, data: unknown) => db.snapshots.put({ attemptId, data, savedAt: Date.now() }).catch(() => null);
export const loadSnapshot = (attemptId: string) => db.snapshots.get(attemptId).catch(() => undefined);
export const clearAttempt = async (attemptId: string) => {
  await db.outbox.where('attemptId').equals(attemptId).delete().catch(() => null);
  await db.events.where('attemptId').equals(attemptId).delete().catch(() => null);
  // the offline copy holds the full paper and answers: never leave it on a shared computer after submitting
  await db.snapshots.delete(attemptId).catch(() => null);
  for (const k of [...memoryOutbox.keys()]) if (k.startsWith(`${attemptId}:`)) memoryOutbox.delete(k);
};
/** Signing out removes every cached exam from this device. */
export const clearAllLocal = async () => {
  await Promise.all([db.outbox.clear(), db.events.clear(), db.snapshots.clear()]).catch(() => null);
  memoryOutbox.clear();
};

/** Monotonic per-attempt sequence counter that survives reloads. */
export function nextSeq(attemptId: string, floor = 0) {
  const k = `eg_seq_${attemptId}`;
  let cur = 0;
  try {
    cur = Number(localStorage.getItem(k) ?? 0);
  } catch {
    /* ignore */
  }
  const n = Math.max(cur, floor) + 1;
  try {
    localStorage.setItem(k, String(n));
  } catch {
    /* ignore */
  }
  return n;
}
