import { InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';
import { LicensesService, LicenseRecord } from './licenses.service';

const TODAY = '2026-09-21';

const license = (
  overrides: Partial<LicenseRecord> = {},
): LicenseRecord => ({
  id: 'license-1',
  organization_id: 'org-1',
  license_type: 'foundation',
  documents_limit: 100,
  documents_used: 0,
  renewal_date: '2027-01-01',
  active: true,
  created_at: null,
  updated_at: null,
  status: 'ACTIVE',
  max_consumer_units: 10,
  document_management: true,
  advanced_analytics: false,
  report_generation: false,
  free_market_management: false,
  start_date: TODAY,
  end_date: null,
  ...overrides,
});

const createService = (data: LicenseRecord[] | null, error: any = null) => {
  const query: any = {};
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.then = (resolve: any) => resolve({ data, error });

  const supabaseService: any = {
    getClient: () => ({
      from: jest.fn(() => query),
    }),
  };

  const auditService: any = {
    logLicenseCreation: jest.fn(),
  };

  return new LicensesService(supabaseService, auditService);
};

describe('LicensesService.resolveEffectiveLicense', () => {
  it('returns null when no effective license exists', async () => {
    const service = createService([]);

    await expect(
      service.resolveEffectiveLicense('org-1', TODAY),
    ).resolves.toBeNull();
  });

  it('returns exactly one effective license', async () => {
    const current = license();
    const service = createService([current]);

    await expect(
      service.resolveEffectiveLicense('org-1', TODAY),
    ).resolves.toEqual(current);
  });

  it('treats start_date equal to today as effective', async () => {
    const current = license({ start_date: TODAY });
    const service = createService([current]);

    await expect(
      service.resolveEffectiveLicense('org-1', TODAY),
    ).resolves.toEqual(current);
  });

  it('treats end_date equal to today as effective', async () => {
    const current = license({ end_date: TODAY });
    const service = createService([current]);

    await expect(
      service.resolveEffectiveLicense('org-1', TODAY),
    ).resolves.toEqual(current);
  });

  it('rejects inactive, invalid-status, future, expired, malformed and foreign candidates', async () => {
    const service = createService([
      license({ id: 'inactive', active: false }),
      license({ id: 'suspended', status: 'suspended', active: false }),
      license({ id: 'future', start_date: '2026-09-22' }),
      license({ id: 'expired', end_date: '2026-09-20' }),
      license({ id: 'malformed', start_date: null }),
      license({ id: 'foreign', organization_id: 'org-2' }),
    ]);

    await expect(
      service.resolveEffectiveLicense('org-1', TODAY),
    ).resolves.toBeNull();
  });

  it('fails closed when effective state is ambiguous', async () => {
    const service = createService([
      license({ id: 'license-1' }),
      license({ id: 'license-2' }),
    ]);

    await expect(
      service.resolveEffectiveLicense('org-1', TODAY),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('fails closed on database error', async () => {
    const service = createService(null, { message: 'database failure' });

    await expect(
      service.resolveEffectiveLicense('org-1', TODAY),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

function retries(results:any[]){
 const calls:any[]=[];let index=0;
 const client={from:(table:string)=>{const scope:any={table};calls.push(scope);const q:any={select:()=>q,eq:(key:string,value:any)=>{scope[key]=value;return q;},then:(resolve:any,reject:any)=>{const r=results[Math.min(index++,results.length-1)];return r instanceof Error?Promise.reject(r).then(resolve,reject):Promise.resolve(r).then(resolve,reject);}};return q;}};
 return {calls,service:new LicensesService({getClient:()=>client} as any,{} as any)};
}
describe('Bounded license read recovery',()=>{
 it.each([{code:'PGRST003'},{code:'08006'},{message:'TypeError: fetch failed'},new Error('fetch failed')])('rechecks the same tenant once after a transient fault %j',async error=>{
  const s=retries([error instanceof Error?error:{data:null,error}, {data:[license()],error:null}]);
  expect(await s.service.resolveEffectiveLicense('org-1',TODAY)).toEqual(license());expect(s.calls).toEqual([{table:'licenses',organization_id:'org-1',active:true},{table:'licenses',organization_id:'org-1',active:true}]);
 });
 it('fails closed after two transient errors',async()=>{const s=retries([{data:null,error:{code:'PGRST003'}}]);await expect(s.service.resolveEffectiveLicense('org-1',TODAY)).rejects.toBeInstanceOf(ServiceUnavailableException);expect(s.calls).toHaveLength(2);});
 it.each(['42501','42703','PGRST301'])('does not retry permanent error %s',async code=>{const s=retries([{data:null,error:{code}}]);await expect(s.service.resolveEffectiveLicense('org-1',TODAY)).rejects.toBeInstanceOf(ServiceUnavailableException);expect(s.calls).toHaveLength(1);});
 it('does not replace a missing license or grant a capability after recovery',async()=>{const s=retries([{data:null,error:{code:'08006'}},{data:[],error:null}]);expect(await s.service.resolveEffectiveLicense('org-1',TODAY)).toBeNull();const denied=retries([{data:[license({document_management:false,start_date:'2020-01-01'})],error:null}]);await expect(denied.service.requireEntitlement('org-1','document_management')).rejects.toThrow('License does not grant');expect(denied.calls).toHaveLength(1);});
 it('still rejects ambiguous licenses after recovery',async()=>{const s=retries([{data:null,error:{code:'08006'}},{data:[license(),license({id:'second'})],error:null}]);await expect(s.service.resolveEffectiveLicense('org-1',TODAY)).rejects.toBeInstanceOf(InternalServerErrorException);});
});
