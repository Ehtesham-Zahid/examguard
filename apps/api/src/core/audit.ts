import crypto from 'node:crypto';
import { prisma } from './prisma.js';

const GENESIS = '0'.repeat(64);
let chain: Promise<unknown> = Promise.resolve();

/** Stable stringify: Postgres jsonb reorders object keys, so hash a canonical (sorted-key) form. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

export function hashEntry(prevHash: string, e: { actorId: string | null; action: string; entity: string; entityId: string | null; data: unknown; createdAt: string }) {
  return crypto
    .createHash('sha256')
    .update(prevHash + canonical([e.actorId, e.action, e.entity, e.entityId, e.data, e.createdAt]))
    .digest('hex');
}

/** Append-only, hash-chained audit log: tampering with any row breaks every hash after it. */
export function audit(actorId: string | null | undefined, action: string, entity: string, entityId: string | null, data: unknown = {}) {
  const run = async () => {
    const last = await prisma.auditLog.findFirst({ orderBy: { seq: 'desc' } });
    const prevHash = last?.hash ?? GENESIS;
    const createdAt = new Date();
    const payload = JSON.parse(JSON.stringify(data ?? {}));
    const hash = hashEntry(prevHash, { actorId: actorId ?? null, action, entity, entityId, data: payload, createdAt: createdAt.toISOString() });
    await prisma.auditLog.create({ data: { actorId: actorId ?? null, action, entity, entityId, data: payload, prevHash, hash, createdAt } });
  };
  chain = chain.then(run, run).catch((e) => console.error('audit failed', e));
  return chain;
}

export async function verifyAuditChain() {
  const rows = await prisma.auditLog.findMany({ orderBy: { seq: 'asc' } });
  let prev = GENESIS;
  for (const r of rows) {
    const expected = hashEntry(prev, { actorId: r.actorId, action: r.action, entity: r.entity, entityId: r.entityId, data: r.data, createdAt: r.createdAt.toISOString() });
    if (r.prevHash !== prev || r.hash !== expected) return { valid: false, brokenAt: r.seq, total: rows.length };
    prev = r.hash;
  }
  return { valid: true, total: rows.length };
}
