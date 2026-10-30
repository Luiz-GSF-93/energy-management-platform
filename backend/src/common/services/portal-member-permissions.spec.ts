import {assertPortalMemberPermission} from './portal-member-permissions';
import {PERMISSIONS as P} from '../constants/permissions';
describe('individual permissions on Portal RPC routes',()=>{
 it('blocks report/document modules even when the shared role still contains them',()=>{expect(()=>assertPortalMemberPermission('reports',[],true)).toThrow();expect(()=>assertPortalMemberPermission('documents',[P.DOCUMENTS_REPORTS_VIEW],true)).toThrow();});
 it('allows the corresponding selected module without granting another module',()=>{expect(()=>assertPortalMemberPermission('documents',[P.DOCUMENTS_VIEW],true)).not.toThrow();expect(()=>assertPortalMemberPermission('reports',[P.DOCUMENTS_VIEW],true)).toThrow();});
 it('preserves unconfigured legacy memberships and identity routes',()=>{expect(()=>assertPortalMemberPermission('reports',[],false)).not.toThrow();expect(()=>assertPortalMemberPermission(null,[],true)).not.toThrow();});
});
