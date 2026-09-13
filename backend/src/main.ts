import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // ✅ SEM setGlobalPrefix (as rotas já têm /api/v1 nos controllers)
  
  // ✅ ATIVAR VALIDAÇÃO GLOBAL
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );
  
  const corsOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'https://app.expertenergy.com.br',
    'https://energy-management-platform-six.vercel.app',
  ];

  if (process.env.CORS_ORIGIN) {
    corsOrigins.push(process.env.CORS_ORIGIN);
  }

  // ✅ CORS CONFIGURADO CORRETAMENTE COM HEADERS CUSTOMIZADOS
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'x-organization-id',
      'x-empresa-id',
      'x-requested-with',
      'Content-Disposition',
    ],
    exposedHeaders: [
      'Content-Length',
      'X-Total-Count',
      'X-Page-Count',
      'Content-Disposition',
    ],
    maxAge: 3600,
    preflightContinue: false,
  });
  
  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`✅ Application is running on: http://localhost:${port}`);
  console.log(`✅ CORS enabled for: ${corsOrigins.join(', ')}`);
  console.log(`✅ Custom headers allowed: x-organization-id, x-empresa-id`);
  console.log(`✅ ValidationPipe enabled globally`);
}

bootstrap().catch(err => {
  console.error('❌ Error starting application:', err);
  process.exit(1);
});
