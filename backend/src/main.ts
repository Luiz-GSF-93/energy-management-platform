import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  console.log('🚀 [STARTUP] Iniciando aplicação...');
  console.log(`📦 NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`🔌 PORT: ${process.env.PORT || 3001}`);
  
  try {
    const app = await NestFactory.create(AppModule);
    console.log('✅ [STARTUP] AppModule criado com sucesso');
    
    // ✅ Adicionar prefixo global
    app.setGlobalPrefix('api/v1');
    console.log('✅ [STARTUP] Prefixo global /api/v1 configurado');
    
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
    console.log('✅ [STARTUP] ValidationPipe configurado');
    
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
    console.log('✅ [STARTUP] CORS configurado');
    
    const port = process.env.PORT || 3001;
    
    console.log(`⏳ [STARTUP] Iniciando servidor na porta ${port}...`);
    await app.listen(port, '0.0.0.0');
    
    console.log(`✅ ============================================`);
    console.log(`✅ Aplicação iniciada com sucesso!`);
    console.log(`✅ URL: http://0.0.0.0:${port}`);
    console.log(`✅ API: http://0.0.0.0:${port}/api/v1`);
    console.log(`✅ Health: http://0.0.0.0:${port}/api/v1/health`);
    console.log(`✅ ============================================`);
  } catch (error) {
    console.error(`❌ [STARTUP] Erro crítico ao iniciar aplicação:`);
    console.error(error);
    process.exit(1);
  }
}

bootstrap();
