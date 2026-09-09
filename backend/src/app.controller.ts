import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      message: '✅ Backend is running!',
      environment: process.env.NODE_ENV || 'development',
    };
  }

  @Get()
  getHello() {
    return this.appService.getHello();
  }
}
