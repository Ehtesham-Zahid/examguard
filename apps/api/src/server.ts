import http from 'node:http';
import { createApp } from './app.js';
import { config } from './core/config.js';
import { initRealtime } from './core/realtime.js';
import { startExpirySweeper } from './services/attempts.service.js';

process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
process.on('uncaughtException', (e) => console.error('uncaughtException', e));

const server = http.createServer(createApp());
initRealtime(server);
startExpirySweeper();
server.listen(config.port, () => console.log(`ExamGuard API listening on :${config.port}`));
