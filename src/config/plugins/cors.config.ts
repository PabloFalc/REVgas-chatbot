import { allowAllOrigins, allowedOrigins } from '../origins';
import type { AppSetup } from '../setup';

export const cors: AppSetup = app => {
  app.enableCors({
    origin: allowAllOrigins ? true : allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
};
