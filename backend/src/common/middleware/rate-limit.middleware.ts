import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

interface RateLimitStore {
  [key: string]: { count: number; resetTime: number };
}

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private store: RateLimitStore = {};
  private readonly WINDOW_MS = 60 * 1000;
  private readonly MAX_REQUESTS = 100;

  use(req: Request, res: Response, next: NextFunction) {
    const key = `${req.ip}:${req.method}:${req.path}`;
    const now = Date.now();

    if (!this.store[key]) {
      this.store[key] = { count: 0, resetTime: now + this.WINDOW_MS };
    }

    const entry = this.store[key];

    if (now > entry.resetTime) {
      entry.count = 0;
      entry.resetTime = now + this.WINDOW_MS;
    }

    entry.count++;

    res.set('X-RateLimit-Limit', this.MAX_REQUESTS.toString());
    res.set('X-RateLimit-Remaining', Math.max(0, this.MAX_REQUESTS - entry.count).toString());
    res.set('X-RateLimit-Reset', entry.resetTime.toString());

    if (entry.count > this.MAX_REQUESTS) {
      return res.status(429).json({
        statusCode: 429,
        message: 'Too many requests',
        retryAfter: Math.ceil((entry.resetTime - now) / 1000),
      });
    }

    next();
  }
}
