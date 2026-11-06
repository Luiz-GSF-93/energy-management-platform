import {normalizeTaxId,validTaxId} from '../../common/validation/tax-id';

export const EVA_PREPARATION_POLICY='eva-preparation-policy-1';
/** Corporate relationship is not installation identity. Never accept an invalid
 * checksum, issuer CNPJ, ambiguous recipient or another company by prefix alone. */
export function companyTaxIdentity(expected:string,found:string[],evidence:{unit:boolean;address:boolean;period:boolean}){
 const target=normalizeTaxId(expected),values=[...new Set(found.map(normalizeTaxId))];
 const exact=values.length===1&&target.length===14&&values[0]===target&&validTaxId(target);
 const sameRoot=!exact&&values.length===1&&target.length===14&&values[0].length===14&&validTaxId(target)&&validTaxId(values[0])&&target.slice(0,8)===values[0].slice(0,8);
 const accepted=exact||sameRoot&&evidence.unit&&evidence.address&&evidence.period;
 return {policy:EVA_PREPARATION_POLICY,relation:exact?'EXACT':sameRoot?'SAME_ROOT':'UNCONFIRMED',accepted,expected:target,found:values,root:sameRoot?target.slice(0,8):null,
  reason:sameRoot?'CNPJ do destinatário e cadastro têm a mesma raiz de 8 posições, com estabelecimentos/dígitos verificadores distintos. '+(accepted?'Vínculo da unidade, endereço e competência comprovam a unidade selecionada; continuar com justificativa automática, sem alterar o cadastro.':'A raiz comum identifica o grupo; conferir UC, endereço e competência antes de vincular a unidade.'):'O CNPJ completo do destinatário deve corresponder ao cadastro ou à raiz comprovada com a unidade.'};
}

const reservationCodes=new Set(['CCEE_ESTIMATE_REVIEW','CCEE_COVERAGE','SUPPLIER_INVOICE_COVERAGE','SUPPLIER_INVOICE_TAX']);
export const isPreparationReservation=(code:string)=>reservationCodes.has(code);
const monetary=(v:unknown)=>typeof v==='string'&&/^(0|[1-9]\d{0,11})\.\d{2}$/.test(v);
/** Only already calculated, source-bound amounts can turn a supplementary review
 * into a reservation. Identity, arithmetic, duplicates and changed sources stay
 * outside this allowlist; no missing quantity, money or tax is invented. */
export function canContinueWithReservation(unit:any,entry:any){
 const c=entry?.context,proof=entry?.comparative?.invoiceProof,fiscal=entry?.comparative?.supplierIcms;
 return [unit.acr,unit.aclBeforeFees,unit.fixedFee].every(monetary)&&
  c?.originalIdentity?.state==='MATCH'&&c.originalIdentity.fileHash===c.document?.file_hash&&
  proof?.documentId===c.document?.id&&proof?.sourceHash===c.document?.file_hash&&
  monetary(proof?.amount)&&proof.amount===entry?.plan?.operational?.invoice?.amount&&
  entry.comparative.amount!==null&&!entry.comparative.missing?.length&&
  (fiscal?.additional!==true||fiscal.method==='ICMS_INSIDE'&&typeof fiscal.source==='string'&&!!fiscal.source.trim()&&fiscal.base===entry?.plan?.operational?.supplier?.amount);
}

export function preparationPolicy(report:any,reservations:any[]=[]){
 const identity=report.units?.some((u:any)=>['MISMATCH','REVIEW'].includes(u.sources?.identityState));
 return {version:EVA_PREPARATION_POLICY,action:identity?'REQUIRES_IDENTITY_DECISION':report.missing?.length?'CONTINUE_AVAILABLE_FIELDS':'CONTINUE_JUSTIFIED',
  canContinueFilling:!identity,financialComplete:report.financial?.status==='AVAILABLE',
  reservations,requiredInputs:report.missing??[],automaticFinancialApproval:false,
  explanation:'Preencher os campos comprovados e registrar ressalvas complementares. Divergências de identidade exigem continuar e justificar ou descontinuar e rejeitar. Valores essenciais ausentes não viram zero; a aprovação continua humana.'};
}
