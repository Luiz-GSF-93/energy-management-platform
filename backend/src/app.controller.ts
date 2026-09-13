import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): any {
    return {
      message: 'Energy Management Platform API',
      version: '0.1.0',
      status: 'running',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('health')
  health(): any {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
