import {
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';

import type {
  AccessContext,
} from '../interfaces/tenant-context.interface';

export const Access = createParamDecorator(
  (
    _data: unknown,
    ctx: ExecutionContext,
  ): AccessContext | null => {
    const request =
      ctx.switchToHttp().getRequest();

    return request.accessContext ?? null;
  },
);
