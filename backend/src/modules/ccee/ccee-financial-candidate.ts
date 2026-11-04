import {BadRequestException} from '@nestjs/common';
export type CceeRubric='EER'|'GUARANTEE'|'PENALTY'|'MCP'|'ASSOCIATIVE';
export const CCEE_FINANCIAL_MAPS=[
 {reportId:'119',frameId:'470',rubric:'ASSOCIATIVE' as CceeRubric,column:'M - VALOR TOTAL DA CONTRIBUI&#199;&#195;O MENSAL &#192; CCEE (K + L) (R$)',label:'CCEE · contribuição associativa mensal',sign:'POSITIVE_DEBIT',version:'CCEE_VCA001_Q2_CONTRIBUTION_1'},
 {reportId:'56',frameId:'264',rubric:'MCP' as CceeRubric,column:'VALOR A LIQUIDAR (R$)',label:'CCEE · liquidação MCP',sign:'NEGATIVE_DEBIT',version:'CCEE_LFN001_Q2_MCP_1'},
 {reportId:'86',frameId:'361',rubric:'PENALTY' as CceeRubric,column:'VALOR A LIQUIDAR (R$)',label:'CCEE · penalidades · liquidação',sign:'NEGATIVE_DEBIT',version:'CCEE_LFPEN001_Q2_PENALTY_1'},
 {reportId:'70',frameId:'318',rubric:'EER' as CceeRubric,column:'VALOR A LIQUIDAR (R$)',label:'CCEE · EER · energia de reserva',sign:'NEGATIVE_DEBIT',version:'CCEE_LFRES001_Q2_EER_1'},
 {reportId:'55',frameId:'262',rubric:'GUARANTEE' as CceeRubric,column:'GARANTIA FINANCEIRA AVULSA APORTADA (R$)',label:'CCEE · aporte de garantia financeira · desembolso separado',sign:'POSITIVE_OUTFLOW',version:'CCEE_GFN001_Q2_APORTE_1'},
] as const;
export function cceeFinancialCandidate(value:any){
 const j=value?.job,b=value?.binding,d=j?.result?.data,m=CCEE_FINANCIAL_MAPS.find(v=>v.reportId===d?.reportId&&v.frameId===d?.frameId);
 if(!m||j?.kind!=='DRI_RESULTS'||j.state!=='SUCCEEDED'||j.result?.complete!==true||d?.rows?.length!==1||!/^\d{14}$/.test(b?.dri_tax_id??'')||d.participantTaxId!==b.dri_tax_id||!/^[a-f0-9]{64}$/.test(d.sourceHash??''))throw new BadRequestException('Quadro financeiro ainda não homologado ou identidade incompleta.');
 const row=d.rows[0],columns=row.columns,cells=row.cells;
 if(row.reportId!==d.reportId||row.frameId!==d.frameId)throw new BadRequestException('Linha de outro quadro financeiro.');
 if(!Array.isArray(columns)||!Array.isArray(cells)||columns.length!==cells.length||new Set(columns).size!==columns.length)throw new BadRequestException('Estrutura financeira mudou.');
 const fiscalColumns=columns.filter((c:string)=>['CNPJ DO AGENTE','CNPJ AGENTE'].includes(c));
 const tax=columns.indexOf(m.rubric==='ASSOCIATIVE'?'CNPJ AGENTE':'CNPJ DO AGENTE'),index=columns.indexOf(m.column);
 if(fiscalColumns.length!==1||tax<0||index<0||typeof cells[tax]!=='string'||cells[tax].replace(/\D/g,'')!==b.dri_tax_id)throw new BadRequestException('Coluna monetária ou participante exige revisão.');
 const signed=cells[index];if(typeof signed!=='string'||!/^[-+]?\d{1,12}(?:\.\d{1,8})?$/.test(signed))throw new BadRequestException('Valor monetário não demonstrado. Ausência não é zero.');
 const [whole,fraction='']=signed.replace(/^[-+]/,'').split('.');if(/[1-9]/.test(fraction.slice(2)))throw new BadRequestException('Fonte com fração de centavo; conferir arredondamento.');
 if(m.sign==='POSITIVE_OUTFLOW'&&signed.startsWith('-'))throw new BadRequestException('Aporte negativo exige fonte específica de liberação de garantia.');
 const amount=BigInt(whole).toString()+'.'+fraction.padEnd(2,'0').slice(0,2),effect=m.sign==='NEGATIVE_DEBIT'?(signed.startsWith('-')?'COST':'CREDIT'):(signed.startsWith('-')?'CREDIT':'COST');
 return{rubric:m.rubric,label:m.label,mapVersion:m.version,jobId:j.id,authorizationId:j.authorization_id,unitId:b.consumer_unit_id,customerId:b.customer_id,accountingMonth:d.month,eventCode:d.eventCode,reportId:d.reportId,frameId:d.frameId,sourceHash:d.sourceHash,sourceColumn:m.column,signedValue:signed,amount,suggestedEffect:effect,notice:m.rubric==='ASSOCIATIVE'?'Contribuição mensal pelo campo total M: não somar novamente parcelas K/L nem usar votos ou orçamento total da CCEE. Confira competência e alocação; não comprova quitação.':m.rubric==='GUARANTEE'?'Aporte informado no escopo do agente: desembolso de garantia separado de despesa. Não usar garantia preliminar nem presumir rateio entre unidades.':m.rubric==='MCP'?'Liquidação MCP no escopo do agente: não somar com SUM001 do mesmo fato. Valor a liquidar não comprova pagamento.':m.rubric==='PENALTY'?'Penalidade no escopo do agente: aplicação, apuração e desembolso podem ser de meses distintos. Não somar principal e valor a liquidar.':'Energia de reserva no escopo do agente. Confira a competência de desembolso e a alocação; não soma liquidação MCP nem comprova todos os encargos.'};
}
