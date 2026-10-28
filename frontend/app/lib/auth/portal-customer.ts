import {session,tokenClaims} from './session';
type Selection={organizationId:string;userId:string;customerId:string};
export function portalSelection():Selection|null {
 if(typeof window==='undefined')return null;
 try{const s=JSON.parse(window.sessionStorage.getItem('portal_customer')??'null');return s&&typeof s.organizationId==='string'&&typeof s.customerId==='string'&&s.userId===tokenClaims(session.getAccessToken()).sub?s:null;}catch{return null;}
}
export function selectPortalCustomer(value:Selection|null){
 if(value)window.sessionStorage.setItem('portal_customer',JSON.stringify(value));else window.sessionStorage.removeItem('portal_customer');
 window.dispatchEvent(new Event('portal-customer-changed'));
}
export const portalSelectionKey=()=>JSON.stringify(portalSelection());
export const portalScopedPath=(path:string)=>path.startsWith('/api/v1/portal/')&&!['/api/v1/portal/customers','/api/v1/portal/access-grants'].some(p=>path.split('?')[0]===p)||path.startsWith('/api/v1/bot-energy/reports/client');
