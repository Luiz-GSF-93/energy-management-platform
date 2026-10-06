import {customerContacts} from './customer-contacts';
import {CustomersService} from './customers.service';
const contact={id:'00000000-0000-4000-8000-000000000010',name:' Financeiro ',department:' Contabilidade ',email:' financeiro@example.invalid ',phone:'+5516999999999',active:true,channels:['sms','email']};
describe('Customer report contacts',()=>{
 it('normalizes fields and preserves identity and channel choice',()=>expect(customerContacts([contact])).toEqual([{...contact,name:'Financeiro',department:'Contabilidade',email:'financeiro@example.invalid',channels:['email','sms']}]));
 it('accepts inactive/empty channel contacts without inventing consent',()=>expect(customerContacts([{...contact,channels:[],active:false}])[0].active).toBe(false));
 it.each([null,{},Array(51).fill(contact),[contact,contact],[{...contact,id:'forged'}],[{...contact,name:''}],[{...contact,email:'bad'}],[{...contact,phone:'1699999999'}],[{...contact,channels:['email','email']}],[{...contact,channels:['push']}],[{...contact,channels:['email'],email:''}],[{...contact,channels:['sms'],phone:''}],[{...contact,active:'true'}],[{...contact,organization_id:'other'}],[{...contact,name:'Injection\r\nBcc: victim'}],[{...contact,department:'x'.repeat(101)}],[{...contact,email:'',phone:''}]])('rejects invalid recipient data %j',v=>expect(()=>customerContacts(v)).toThrow());
 it('writes through existing atomic audit with authenticated tenant and actor',async()=>{
  const rpc=jest.fn().mockResolvedValue({data:{id:'c'},error:null}),s=new CustomersService({getClient:()=>({rpc})} as any);
  await s.update('c','org-A',{changes:{report_contacts:[contact]},reason:'Contato autorizado',expectedVersion:2,requestId:'00000000-0000-4000-8000-000000000011'},'actor');
  expect(rpc).toHaveBeenCalledWith('edit_registration',expect.objectContaining({p_org:'org-A',p_actor:'actor',p_expected:2,p_changes:{report_contacts:customerContacts([contact])}}));
 });
});
