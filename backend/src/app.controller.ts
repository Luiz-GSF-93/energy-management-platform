import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller('/api/v1')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): any {
    return { message: 'Energy Management Platform API', version: '0.1.0' };
  }

  @Get('/health')
  health(): any {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
