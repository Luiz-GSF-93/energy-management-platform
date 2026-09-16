import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './common/decorators/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      message: '✅ Backend is running!',
      environment: process.env.NODE_ENV || 'development',
    };
  }

  @Public()
  @Get()
  getHello() {
    return this.appService.getHello();
  }
}
