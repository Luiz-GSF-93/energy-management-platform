import { createParamDecorator, ExecutionContext, Logger } from '@nestjs/common';

const logger = new Logger('TenantDecorator');

export const Tenant = createParamDecorator((data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  const tenantContext = request.tenantContext;

  logger.log(`[@Tenant] Extracting context: org=${tenantContext?.organizationId}, role=${tenantContext?.role}`);

  if (!tenantContext) {
    logger.error(`[@Tenant] No tenant context found on request!`);
    return null;
  }

  return tenantContext;
});

export const OrganizationId = createParamDecorator((data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  const tenantContext = request.tenantContext;

  if (!tenantContext) {
    logger.warn(`[@OrganizationId] No tenant context found`);
    return 'org_default';
  }

  logger.log(`[@OrganizationId] Returning org: ${tenantContext.organizationId}`);
  return tenantContext.organizationId;
});

export const UserId = createParamDecorator((data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  const tenantContext = request.tenantContext;

  if (!tenantContext) {
    logger.warn(`[@UserId] No tenant context found`);
    return null;
  }

  logger.log(`[@UserId] Returning userId: ${tenantContext.userId}`);
  return tenantContext.userId;
});
