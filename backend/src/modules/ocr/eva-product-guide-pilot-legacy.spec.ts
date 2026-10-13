import {EvaProductGuideService,productGuidePilotConfig} from './eva-product-guide.service';
import {PRODUCT_GUIDE_DRAFTS} from './eva-product-guides';
import {PERMISSIONS as P} from '../../common/constants/permissions';
const legacy='org_default',uuid='00000000-0000-4000-8000-000000000001';
const guide:any={...PRODUCT_GUIDE_DRAFTS[0],revision:{...PRODUCT_GUIDE_DRAFTS[0].revision,state:'PUBLISHED',reviewedBy:'reviewer',reviewedAt:'2026-10-12T10:00:00Z',publishedAt:'2026-10-12T11:00:00Z'},review:{reference:'review',documentHash:PRODUCT_GUIDE_DRAFTS[0].revision.hash,contentHash:PRODUCT_GUIDE_DRAFTS[0].revision.contentHash}};
const tenant:any={organizationId:legacy,scope:'organization',userId:'user',role:'admin_org',permissions:Object.values(P)};
function fixture(enabled=true){const read=jest.fn(async()=>({organization_id:legacy,active:true,status:'active',start_date:'2026-01-01',end_date:null,bot_energy_rag:true,document_management:true,free_market_management:true}));return {read,service:new EvaProductGuideService({resolveEffectiveLicense:read} as any,productGuidePilotConfig({EVA_PRODUCT_GUIDES_ENABLED:enabled?'true':'false',EVA_PRODUCT_GUIDES_ORGANIZATIONS:legacy}),[guide],()=>new Date('2026-10-13T12:00:00Z'))};}
describe('EVA explicitly configured legacy pilot',()=>{
 it('accepts only the named legacy identifier or valid UUIDs',()=>{expect(productGuidePilotConfig({EVA_PRODUCT_GUIDES_ORGANIZATIONS:legacy+','+uuid+','+legacy}).organizations).toEqual([legacy,uuid]);});
 it.each(['org_other','ORG_DEFAULT','org_default*','org_default/','*','org_default;','org_default,unknown'])('rejects invalid allowlist %s',value=>{expect(productGuidePilotConfig({EVA_PRODUCT_GUIDES_ORGANIZATIONS:value}).organizations).toEqual([])});
 it('keeps enablement explicit',async()=>{const f=fixture(false);expect(await f.service.topics(tenant)).toEqual([]);expect(f.read).not.toHaveBeenCalled()});
 it('allows a published procedural response without approving actions',async()=>{const f=fixture();expect(await f.service.topics(tenant)).toHaveLength(1);expect(await f.service.answer(tenant,{topic:guide.key})).toMatchObject({mode:'PRODUCT_GUIDE',status:'SUPPORTED',canApprove:false,canPublish:false})});
 it.each([{organizationId:uuid},{organizationId:'org_other'},{scope:'global'},{accessMode:'platform_operation'},{permissions:[]},{role:'client'}])('does not broaden authorization %j',async patch=>{const f=fixture();expect(await f.service.topics({...tenant,...patch})).toEqual([]);expect(f.read).not.toHaveBeenCalled()});
 it('retains license admission for the legacy organization',async()=>{const f=fixture();f.read.mockResolvedValue({organization_id:legacy,active:false} as any);expect(await f.service.topics(tenant)).toEqual([])});
});
