import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  app.setGlobalPrefix('api/v1');
  
  const corsOrigins: string[] = [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://app.expertenergy.com.br',
    'https://energy-management-platform-six.vercel.app',
  ];

  if (process.env.CORS_ORIGIN) {
    corsOrigins.push(process.env.CORS_ORIGIN);
  }

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  
  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`✅ Application is running on: http://localhost:${port}`);
  console.log(`✅ CORS enabled for: ${corsOrigins.join(', ')}`);
}

bootstrap().catch(err => {
  console.error('❌ Error starting application:', err);
  process.exit(1);
});
