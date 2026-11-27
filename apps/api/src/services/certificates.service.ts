import crypto from 'node:crypto';
import { prisma } from '../core/prisma.js';
import { config } from '../core/config.js';

/**
 * Verifiable reports (4.6): every published result gets a short code and an Ed25519 signature over a
 * minimal payload. The /verify page re-checks the signature with the public key, so an edited PDF or
 * forged code is detected — while exposing only initials, exam, score and date.
 */
function loadKey() {
  const b64 = process.env.SIGNING_PRIVATE_KEY;
  if (b64) return crypto.createPrivateKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'pkcs8' });
  // deterministic dev key derived from the JWT secret (stable across restarts / free-tier redeploys)
  const seed = crypto.createHash('sha256').update(`${config.jwtSecret}:ed25519`).digest();
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
  return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}
const privateKey = loadKey();
const publicKey = crypto.createPublicKey(privateKey);
export const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => `${p[0].toUpperCase()}${'*'.repeat(Math.max(2, Math.min(p.length - 1, 5)))}`)
    .join(' ');

const canonical = (o: Record<string, unknown>) => JSON.stringify(Object.keys(o).sort().reduce((a, k) => ({ ...a, [k]: o[k] }), {}));
export const sign = (payload: Record<string, unknown>) => crypto.sign(null, Buffer.from(canonical(payload)), privateKey).toString('base64url');
export const verifySignature = (payload: Record<string, unknown>, sig: string) => {
  try {
    return crypto.verify(null, Buffer.from(canonical(payload)), publicKey, Buffer.from(sig, 'base64url'));
  } catch {
    return false;
  }
};

const newCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(10);
  const s = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  return `EG-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 10)}`;
};

export async function issueCertificate(attemptId: string) {
  const a = await prisma.attempt.findUniqueOrThrow({ where: { id: attemptId }, include: { exam: true, candidate: true, certificate: true } });
  const code = a.certificate?.code ?? newCode();
  const pct = a.maxScore ? Math.round(((a.score ?? 0) / a.maxScore) * 1000) / 10 : 0;
  const payload = {
    code,
    exam: a.exam.title,
    candidate: initials(a.candidate.name),
    score: a.score ?? 0,
    maxScore: a.maxScore,
    percentage: pct,
    result: (a.score ?? 0) >= a.exam.passMarks ? 'PASS' : 'FAIL',
    issuedAt: new Date().toISOString(),
    ref: crypto.createHash('sha256').update(a.id).digest('hex').slice(0, 12),
  };
  const signature = sign(payload);
  return prisma.certificate.upsert({ where: { attemptId }, update: { payload, signature, revoked: false, issuedAt: new Date() }, create: { attemptId, code, payload, signature } });
}

export async function verifyCode(code: string) {
  const c = await prisma.certificate.findUnique({ where: { code: code.trim().toUpperCase() } });
  if (!c) return { valid: false, reason: 'No result report exists with this verification code' };
  const payload = c.payload as Record<string, unknown>;
  const sigOk = verifySignature(payload, c.signature);
  if (!sigOk) return { valid: false, reason: 'Signature check failed — this record has been altered' };
  if (c.revoked) return { valid: false, reason: 'This report has been superseded or revoked', payload };
  return { valid: true, payload, signature: c.signature };
}
