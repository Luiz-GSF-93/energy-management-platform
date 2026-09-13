import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DocumentEntity } from '../modules/document-processing/entities/document.entity';

export const getTypeOrmConfig = (): TypeOrmModuleOptions => {
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    type: 'postgres',
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432'),
    username: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'postgres',
    database: process.env.DATABASE_NAME || 'energy_db',
    entities: [DocumentEntity],
    synchronize: false,
    logging: false,
    ssl: isProduction ? { rejectUnauthorized: false } : false,
    // Reduzir tentativas e timeouts
    retryAttempts: 0,
    retryDelay: 0,
    connectTimeoutMS: 3000,
  };
};
