import { BadRequestException, ForbiddenException, Logger, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleGuard } from '../../../../common/guards/role.guard';
import { PERMISSIONS } from '../../../../common/constants/permissions';
import { UserRecoveryService } from './user-recovery.service';
import { UserRecoveryController, UserRecoveryRequestDto } from '../controllers/user-recovery.controller';

describe('Organization user recovery', () => {
  const tenant: any = { organizationId: 'org-a', userId: 'actor', permissions: [PERMISSIONS.ORGANIZATION_USERS_UPDATE] };
  let users: any, recovery: any, service: UserRecoveryService;
  beforeEach(() => {
    users = { findOne: jest.fn().mockResolvedValue({ userId: 'target', email: 'member@example.com', role: { id: 'role-a' }, membershipStatus: 'active' }), assertAssignable: jest.fn().mockResolvedValue(undefined) };
    recovery = { requestManaged: jest.fn().mockResolvedValue({ message: 'accepted' }) };
    service = new UserRecoveryService(users, recovery);
  });
  it('resolves membership and recipient in the authorized organization before sending', async () => {
    expect(await service.request('target', tenant, 'ip')).toEqual({ message: 'accepted' });
    expect(users.findOne).toHaveBeenCalledWith('target', 'org-a');
    expect(users.assertAssignable).toHaveBeenCalledWith('role-a', 'org-a', tenant.permissions, false);
    expect(recovery.requestManaged).toHaveBeenCalledWith('member@example.com', 'ip');
  });
  it('denies targets outside the organization', async () => {
    users.findOne.mockRejectedValue(new NotFoundException());
    await expect(service.request('other-org-user', tenant, 'ip')).rejects.toThrow(NotFoundException);
    expect(recovery.requestManaged).not.toHaveBeenCalled();
  });
  it('denies inactive memberships', async () => {
    users.findOne.mockResolvedValue({ membershipStatus: 'inactive' });
    await expect(service.request('target', tenant, 'ip')).rejects.toThrow('inativo');
    expect(recovery.requestManaged).not.toHaveBeenCalled();
  });
  it('denies a role above the actor and admin_org for non-platform actors', async () => {
    users.assertAssignable.mockRejectedValue(new BadRequestException());
    await expect(service.request('target', tenant, 'ip')).rejects.toThrow(ForbiddenException);
    expect(recovery.requestManaged).not.toHaveBeenCalled();
  });
  it('passes only the server-resolved platform operation mode', async () => {
    await service.request('target', { ...tenant, accessMode: 'platform_operation' }, 'ip');
    expect(users.assertAssignable).toHaveBeenCalledWith('role-a', 'org-a', tenant.permissions, true);
  });
  it('allows recovery of the actor own active account without assigning a role', async () => {
    await service.request('actor', tenant, 'ip');
    expect(users.assertAssignable).not.toHaveBeenCalled();
    expect(recovery.requestManaged).toHaveBeenCalledTimes(1);
  });
  it('fails closed when role authorization cannot be checked', async () => {
    users.assertAssignable.mockRejectedValue(new Error('database unavailable'));
    await expect(service.request('target', tenant, 'ip')).rejects.toThrow();
    expect(recovery.requestManaged).not.toHaveBeenCalled();
  });
  it('does not report success when the email service rejects the request', async () => {
    recovery.requestManaged.mockRejectedValue(new Error('provider unavailable'));
    await expect(service.request('target', tenant, 'ip')).rejects.toThrow();
  });
  it('records actor, organization and target without email or credentials', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    try {
      await service.request('target', tenant, 'ip');
      expect(log).toHaveBeenCalledWith(JSON.stringify({ event: 'organization_user_recovery', actorUserId: 'actor', organizationId: 'org-a', targetUserId: 'target', outcome: 'provider_accepted' }));
      expect(JSON.stringify(log.mock.calls)).not.toContain('member@example.com');
    } finally { log.mockRestore(); }
  });
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  it('accepts an empty command body', async () => {
    await expect(pipe.transform({}, { type: 'body', metatype: UserRecoveryRequestDto })).resolves.toEqual({});
  });
  it.each(['email', 'redirectTo', 'organizationId', 'platformOperation', 'password'])('rejects injected %s', async field => {
    await expect(pipe.transform({ [field]: 'untrusted' }, { type: 'body', metatype: UserRecoveryRequestDto })).rejects.toThrow();
  });
  it.each([true, false])('requires update permission: %s', async allowed => {
    const guard = new RoleGuard(new Reflector());
    const context: any = { getHandler: () => UserRecoveryController.prototype.request, switchToHttp: () => ({ getRequest: () => ({ tenantContext: { permissions: allowed ? tenant.permissions : [PERMISSIONS.ORGANIZATION_USERS_VIEW] } }) }) };
    if (allowed) await expect(guard.canActivate(context)).resolves.toBe(true);
    else await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });
});
