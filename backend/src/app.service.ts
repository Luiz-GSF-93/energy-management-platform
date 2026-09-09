import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return '⚡ Energy Management Platform Backend API v1.0.0';
  }
}
