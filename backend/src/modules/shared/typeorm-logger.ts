import { Logger as TypeOrmLogger } from 'typeorm';
import { Logger } from '@nestjs/common';

export class CustomTypeOrmLogger implements TypeOrmLogger {
  private logger = new Logger('TypeORM');

  log(level: 'log' | 'info' | 'warn', message: string, queryRunner?: any): any {
    if (level === 'log' || level === 'info') {
      this.logger.log(message);
    } else if (level === 'warn') {
      this.logger.warn(message);
    }
  }

  logQuery(query: string, parameters?: any[], queryRunner?: any): any {
    this.logger.debug(`Query: ${query}`, { parameters });
  }

  logQueryError(error: string, query: string, parameters?: any[], queryRunner?: any): any {
    this.logger.error(`Query Error: ${error}`, { query, parameters });
  }

  logQuerySlow(time: number, query: string, parameters?: any[], queryRunner?: any): any {
    this.logger.warn(`Slow Query (${time}ms): ${query}`);
  }

  logSchemaBuild(message: string, queryRunner?: any): any {
    this.logger.log(message);
  }

  logMigration(message: string, queryRunner?: any): any {
    this.logger.log(message);
  }
}
