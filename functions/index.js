import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { onRequest } from 'firebase-functions/v2/https';
import { handleOpenAI } from './openai.js';

initializeApp();

export const studioOpenAI = onRequest({
  region: 'asia-southeast1',
  cors: ['https://dinsudiro.github.io'],
  timeoutSeconds: 210,
  memory: '512MiB',
  maxInstances: 3,
  concurrency: 4,
}, (req, res) => handleOpenAI(req, res, {
  verifyToken: token => getAuth().verifyIdToken(token),
}));
