import { prisma } from './prisma.js';
import { emitToUser } from './realtime.js';

export async function notify(userIds: string[], title: string, body = '', link?: string) {
  if (!userIds.length) return;
  await prisma.notification.createMany({ data: userIds.map((userId) => ({ userId, title, body, link })) });
  userIds.forEach((u) => emitToUser(u, 'notification', { title, body, link }));
}
