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
    socket.on('join:exam', async (examId: string, ack?: (ok: boolean) => void) => {
      // Staff join the monitor room; candidates join the candidate room only if enrolled
      const exam = await prisma.exam.findUnique({ where: { id: examId } });
      if (!exam) return ack?.(false);
      if (user.role === 'ADMIN' || exam.ownerId === user.id) {
        socket.join(`monitor:${examId}`);
        return ack?.(true);
      }
      const enrolled = await prisma.enrollment.findUnique({ where: { examId_candidateId: { examId, candidateId: user.id } } });
      if (enrolled) {
        socket.join(`exam:${examId}`);
        return ack?.(true);
      }
      ack?.(false);
    });
  });
  return io;
}

export const emitToMonitors = (examId: string, event: string, data: unknown) => io?.to(`monitor:${examId}`).emit(event, data);
export const emitToCandidates = (examId: string, event: string, data: unknown) => io?.to(`exam:${examId}`).emit(event, data);
export const emitToUser = (userId: string, event: string, data: unknown) => io?.to(`user:${userId}`).emit(event, data);
