import { INestApplication, Module } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { AddressInfo } from 'net';
import { CustomersController } from '../../modules/customers/controllers/customers.controller';
import { CustomersService } from '../../modules/customers/services/customers.service';
import { LicensesController } from '../../modules/licenses/controllers/licenses.controller';
import { LicensesService } from '../../modules/licenses/services/licenses.service';
import { SupabaseService } from '../../services/supabase.service';
import { TenantInterceptor } from '../interceptors/tenant.interceptor';
import { RoleGuard } from '../guards/role.guard';
import { PERMISSIONS } from '../constants/permissions';

const insert = jest.fn();
const update = jest.fn();
const from = jest.fn();
const licenses = { create: jest.fn() };

@Module({
  controllers: [CustomersController, LicensesController],
  providers: [CustomersService,
    { provide: SupabaseService, useValue: { getClient: () => ({ from }) } },
    { provide: LicensesService, useValue: licenses }],
})
class HttpTestModule {}

describe('HTTP validation + tenant interceptor + RBAC', () => {
  let app: INestApplication;
  let base: string;
  let permitted = true;

  beforeAll(async () => {
    app = await NestFactory.create(HttpTestModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    // Authentication is stubbed only here; the actual RoleGuard and interceptor
    // run in Nest's HTTP lifecycle. Existing guard suites cover authentication.
    app.useGlobalGuards({ canActivate: ctx => {
      ctx.switchToHttp().getRequest().tenantContext = {
        scope: 'organization', organizationId: 'org-a', userId: 'user-a',
        permissions: permitted ? Object.values(PERMISSIONS) : [],
      };
      return true;
    } }, new RoleGuard(app.get(Reflector)));
    app.useGlobalInterceptors(new TenantInterceptor(app.get(Reflector)));
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(() => {
    permitted = true;
    const query: any = {
      insert, update, select: jest.fn(() => query),
      eq: jest.fn(() => query), single: jest.fn().mockResolvedValue({ data: { id: 'saved' }, error: null }),
    };
    insert.mockImplementation(() => query);
    update.mockImplementation(() => query);
    from.mockImplementation(() => query);
    licenses.create.mockResolvedValue({ id: 'license-a' });
  });
  const send = (path: string, body: unknown, method = 'POST') => fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  it('accepts valid customer creation and derives organization from context', async () => {
    const body = { company_name: 'Example', document: '12345678000190' };
    expect((await send('/customers', body)).status).toBe(201);
    expect(insert).toHaveBeenCalledWith([{ ...body, organization_id: 'org-a' }]);
  });
  it.each(['id', 'organization_id', 'created_at', 'deleted_at'])(
    'rejects mass assignment of %s via HTTP', async field => {
      const response = await send('/customers/record-a', {
        company_name: 'Changed', [field]: 'org-a',
      }, 'PUT');
      expect(response.status).toBe(400);
      expect(update).not.toHaveBeenCalled();
    },
  );
  it('rejects cross-tenant payload before database access', async () => {
    expect((await send('/customers', { organization_id: 'org-b' })).status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });
  it('preserves permission denial before writing', async () => {
    permitted = false;
    expect((await send('/customers', { company_name: 'Example', document: '123' })).status).toBe(403);
    expect(from).not.toHaveBeenCalled();
  });
  it('does not inject organization_id into the strict license DTO', async () => {
    const response = await send('/licenses', {
      licenseType: 'TEST', documentsLimit: 100,
      renewalDate: '2027-01-01', startDate: '2026-09-01',
    });
    expect(response.status).toBe(201);
    expect(licenses.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ organization_id: expect.anything() }),
      expect.objectContaining({ organizationId: 'org-a', actorUserId: 'user-a' }),
    );
  });
});
