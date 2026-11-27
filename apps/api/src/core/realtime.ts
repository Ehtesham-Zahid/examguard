import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { config } from './config.js';
import { resolveUserFromToken } from './auth.js';
import { prisma } from './prisma.js';

let io: Server | null = null;

export function initRealtime(server: HttpServer) {
  io = new Server(server, { cors: { origin: config.clientOrigins, credentials: true } });
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error('unauthorized'));
      socket.data.user = await resolveUserFromToken(token);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });
  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join(`user:${user.id}`);
    socket.on('leave:exam', (examId: string) => {
      socket.leave(`monitor:${examId}`);
      socket.leave(`exam:${examId}`);
    });
    socket.on('join:exam', async (examId: unknown, ack?: unknown) => {
      const reply = (ok: boolean) => typeof ack === 'function' && (ack as (ok: boolean) => void)(ok);
      try {
        if (typeof examId !== 'string' || !examId || examId.length > 64) return reply(false);
        // re-read the user: role or status may have changed since the socket connected
        const fresh = await prisma.user.findUnique({ where: { id: user.id }, select: { role: true, status: true } });
        if (!fresh || fresh.status !== 'ACTIVE') {
          reply(false);
          return socket.disconnect(true);
        }
        const exam = await prisma.exam.findUnique({ where: { id: examId } });
        if (!exam) return reply(false);
        if (fresh.role === 'ADMIN' || (fresh.role === 'EXAMINER' && exam.ownerId === user.id)) {
          socket.join(`monitor:${examId}`);
          return reply(true);
        }
        const enrolled = await prisma.enrollment.findUnique({ where: { examId_candidateId: { examId, candidateId: user.id } } });
        if (enrolled) {
          socket.join(`exam:${examId}`);
          return reply(true);
        }
        reply(false);
      } catch (e) {
        console.error('join:exam failed', e);
        reply(false);
      }
    });
  });
  return io;
}

/** Drop every live socket of a user (role change, disable, logout everywhere, password change). */
export const disconnectUser = (userId: string) => io?.in(`user:${userId}`).disconnectSockets(true);

export const emitToMonitors = (examId: string, event: string, data: unknown) => io?.to(`monitor:${examId}`).emit(event, data);
export const emitToCandidates = (examId: string, event: string, data: unknown) => io?.to(`exam:${examId}`).emit(event, data);
export const emitToUser = (userId: string, event: string, data: unknown) => io?.to(`user:${userId}`).emit(event, data);
