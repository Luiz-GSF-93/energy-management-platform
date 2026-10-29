import {resolvePortalUnits,selectedPortalUnits} from './portal-selected-units';
describe('portal selected units',()=>{
 it('keeps absent filters compatible and sorts an explicit subset',()=>{expect(selectedPortalUnits(undefined,['a','b'])).toBeNull();expect(selectedPortalUnits('b,a',['a','b','c'])).toEqual(['a','b']);});
 it.each(['','a,a','a,','a,foreign','a/../b',Array(201).fill('x').join(',')])('rejects invalid or foreign selection %p',value=>expect(()=>selectedPortalUnits(value,['a','b'])).toThrow());
 it('rejects combined single and multiple filters',()=>expect(()=>selectedPortalUnits('a',['a'],'a')).toThrow());
 it('resolves live identity and intersects managed access',async()=>{const rpc=jest.fn(async()=>({data:{organizationId:'o',customerId:'c',units:[{id:'a'},{id:'b'}]}})),t:any={organizationId:'o',userId:'u',roleId:'r',portalCustomerScope:{customerId:'c',units:[{id:'a'}]}};expect(await resolvePortalUnits({rpc},t,'a')).toEqual(['a']);await expect(resolvePortalUnits({rpc},t,'b')).rejects.toThrow();expect(rpc).toHaveBeenCalledWith('portal_presentation_action',expect.objectContaining({p_org:'o',p_actor:'u',p_action:'identity'}));});
 it.each([{error:{code:'42501'}},{data:{organizationId:'other',customerId:'c',units:[{id:'a'}]}},{data:{organizationId:'o',customerId:'foreign',units:[{id:'a'}]}}])('rejects revocation and tenant/customer mismatch',async result=>{await expect(resolvePortalUnits({rpc:async()=>result},{organizationId:'o',portalCustomerScope:{customerId:'c',units:[{id:'a'}]}} as any,'a')).rejects.toThrow();});
});
