import type {CorrectionContext} from './preparation-navigation';
const tabs=['parameters','monthly','costs','preparation','distributor','supply','management','services'] as const;
export type OcrDestination=typeof tabs[number];
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function ocrContractLink(documentId:string,tab:OcrDestination){return '/backoffice/contracts?ocrDocument='+encodeURIComponent(documentId)+'&area='+tab;}
export function ocrNavigationRequest(search:string){const q=new URLSearchParams(search);if(!q.has('ocrDocument'))return null;const id=q.get('ocrDocument')??'',tab=q.get('area')??'preparation';if(q.getAll('ocrDocument').length!==1||q.getAll('area').length>1||!uuid.test(id)||!tabs.includes(tab as OcrDestination))throw Error('O link da fatura é inválido. Abra novamente pelo painel de homologação.');return {id,tab:tab as OcrDestination};}
export function ocrNavigationContext(request:{id:string;tab:OcrDestination},data:{documentId:string;customerId:string;unitId:string;month:string},customers:{id:string}[],units:{id:string;customer_id:string}[]):CorrectionContext{
 if(data.documentId!==request.id||!uuid.test(data.customerId)||!uuid.test(data.unitId)||!/^(20|21)\d{2}-(0[1-9]|1[0-2])$/.test(data.month)||!customers.some(c=>c.id===data.customerId)||!units.some(u=>u.id===data.unitId&&u.customer_id===data.customerId))throw Error('O cliente ou a unidade da fatura não está disponível na organização ativa. Nenhum cadastro foi selecionado.');
 return {customerId:data.customerId,unitId:data.unitId,month:data.month,tab:request.tab,message:'Contexto carregado da fatura. Confira os registros desta unidade e competência; abrir esta área não importa nem aprova valores.'};
}
