import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return '✅ Energy Management Platform - API Ready';
  }
  
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      message: '✅ Backend is running!',
      environment: process.env.NODE_ENV || 'development',
    };
  }
}
