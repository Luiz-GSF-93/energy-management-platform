import {OcrAutofillService} from './ocr-autofill.service';
import {PERMISSIONS as P} from '../../common/constants/permissions';
const doc='11111111-1111-4111-a111-111111111111',unit='22222222-2222-4222-a222-222222222222',lib='33333333-3333-4333-a333-333333333333';
function fixture(){
 const t:any={organizationId:'org-a',userId:'operator',role:'operacional',permissions:[P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW,P.ENERGIA_OCR_PROCESS,P.ORGANIZATION_CONTRACTS_UPDATE]};
 const library={apply:jest.fn(async()=>({parameter_ids:['draft']}))},licenses={requireEntitlement:jest.fn(async()=>{})};
 const service=new OcrAutofillService({} as any,licenses as any,{} as any,library as any);
 const filled={token:'a'.repeat(64),month:'2026-08',unitId:unit,library:{id:lib,scenario:'ACR'},source:'document · SHA-256 exact'};
 jest.spyOn(service,'inspect').mockResolvedValue(filled as any);
 const settings={consumerUnitId:unit,startDate:'2026-08-01',endDate:'2026-08-31',scenario:'ACR',includedTaxes:true,selected:['TE:PEAK'],embeddedCodes:['ICMS'],taxes:[],cip:'0',other:'0',otherLabel:'',aclSource:'',reason:'Conferido no documento.',expiredConfirmed:false,expiredReason:''};
 const body={token:filled.token,libraryId:lib,checkedPdf:true,acknowledged:true,settings};
 return {service,t,body,library};
}
describe('source-scoped assistant library drafts',()=>{
 it('allows an authorized operator to prepare drafts through the existing audited library service',async()=>{const f=fixture();await f.service.applyLibrary(doc,f.t,f.body);expect(f.library.apply).toHaveBeenCalledWith(lib,expect.objectContaining({consumerUnitId:unit,reason:expect.stringContaining('SHA-256 exact')}),'org-a','operator');});
 it.each([{token:'old'},{libraryId:unit},{checkedPdf:false},{acknowledged:false},{organizationId:'org-b'}])('rejects stale evidence or missing attestation before writes: %p',async patch=>{const f=fixture();await expect(f.service.applyLibrary(doc,f.t,{...f.body,...patch})).rejects.toThrow();expect(f.library.apply).not.toHaveBeenCalled();});
 it.each([{consumerUnitId:doc},{scenario:'ACL'},{startDate:'2026-07-01'},{cip:'137.58'},{other:'5.00'}])('rejects changed scope or copied costs: %p',async patch=>{const f=fixture();await expect(f.service.applyLibrary(doc,f.t,{...f.body,settings:{...f.body.settings,...patch}})).rejects.toThrow();expect(f.library.apply).not.toHaveBeenCalled();});
 it('denies a client and an operator missing OCR permission',async()=>{const f=fixture();f.t.role='cliente';await expect(f.service.applyLibrary(doc,f.t,f.body)).rejects.toThrow();f.t.role='operacional';f.t.permissions=f.t.permissions.filter((p:string)=>p!==P.ENERGIA_OCR_PROCESS);await expect(f.service.applyLibrary(doc,f.t,f.body)).rejects.toThrow();expect(f.library.apply).not.toHaveBeenCalled();});
});
