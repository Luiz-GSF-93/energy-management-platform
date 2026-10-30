import {assertInvitePasswordSetup} from './invite-password-policy';
describe('first password policy',()=>{
 it('blocks protected routes while trusted setup is pending',()=>{expect(()=>assertInvitePasswordSetup({app_metadata:{energyos_password_setup_required:true}},'/api/v1/admin/users')).toThrow('Defina sua senha');});
 it('allows only the authenticated invitation endpoint while setup is pending',()=>{expect(()=>assertInvitePasswordSetup({app_metadata:{energyos_password_setup_required:true}},'/api/v1/auth/accept-invite')).not.toThrow();expect(()=>assertInvitePasswordSetup({app_metadata:{energyos_password_setup_required:true}},'/api/v1/auth/my-organizations')).toThrow();});
 it('preserves existing accounts and ignores untrusted invitation hints',()=>{expect(()=>assertInvitePasswordSetup({},'/api/v1/auth/context')).not.toThrow();expect(()=>assertInvitePasswordSetup({app_metadata:{energyos_password_setup_required:false}},'/api/v1/auth/context')).not.toThrow();});
});
