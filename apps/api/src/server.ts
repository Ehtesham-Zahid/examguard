import http from 'node:http';
import { createApp } from './app.js';
import { config } from './core/config.js';
import { initRealtime } from './core/realtime.js';
import { startExpirySweeper } from './services/attempts.service.js';
import { startEmailWorker } from './services/email/outbox.js';

process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
process.on('uncaughtException', (e) => console.error('uncaughtException', e));

const server = http.createServer(createApp());
initRealtime(server);
startExpirySweeper();
if (process.env.EMAIL_WORKER !== 'off') startEmailWorker();
server.listen(config.port, () => console.log(`Examify API listening on :${config.port}`));
