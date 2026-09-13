import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // ✅ Adicionar prefixo global aqui
  app.setGlobalPrefix('api/v1');
  
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
  await app.listen(port, '0.0.0.0');
  console.log(`✅ Aplicação rodando em: http://0.0.0.0:${port}`);
  console.log(`✅ Prefixo global: /api/v1`);
  console.log(`✅ CORS habilitado para: ${corsOrigins.join(', ')}`);
  console.log(`✅ Headers customizados: x-organization-id, x-empresa-id`);
  console.log(`✅ ValidationPipe ativo globalmente`);
}

bootstrap().catch(err => {
  console.error('❌ Erro ao iniciar aplicação:', err);
  process.exit(1);
});
