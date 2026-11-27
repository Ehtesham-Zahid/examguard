import http from 'node:http';
import { createApp } from './app.js';
import { config } from './core/config.js';
import { initRealtime } from './core/realtime.js';
import { startExpirySweeper } from './services/attempts.service.js';

const server = http.createServer(createApp());
initRealtime(server);
startExpirySweeper();
server.listen(config.port, () => console.log(`ExamGuard API listening on :${config.port}`));
