import {Alert} from '@/app/components/ui';

export type Binding = {
 id:string;customer_id:string;consumer_unit_id:string;profile_code:string;
 principal_profile_code:string|null;measurement_point:string;status:string;revision:number;
 valid_from:string|null;valid_to:string|null;representation_kind:string|null;
 dri_agent_code?:string|null;dri_tax_id?:string|null;measurement_basis:string;service_scope:string[];meter_code?:string|null;
 evidence_reference?:string;revision_reason?:string|null;created_by?:string;
 created_at?:string;reviewed_by?:string|null;reviewed_at?:string|null;
 customer_name?:string|null;customer_document?:string|null;unit_name?:string|null;
 consumer_unit_number?:string|null;distributor?:string|null;identity_complete?:boolean;
};
const missing='Não disponível nesta consulta';
const services:Record<string,string>={POINTS:'Conferir ponto',MEASUREMENTS:'Consultar medições',AGENDA:'Aplicar obrigações à unidade',DRI_READ:'Consultar DRI no escopo do agente'};
const bases:Record<string,string>={UNKNOWN:'A conferir — base de perdas não comprovada',NO_LOSSES:'Sem perdas, compatível com a conciliação',WITH_LOSSES:'Com perdas — conciliação necessária'};
export function documentaryDate(value:string|null|undefined){
 // A documentary date has no time zone. Avoid converting midnight UTC to the previous day.
 const match=value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
 return match?`${match[3]}/${match[2]}/${match[1]}`:missing;
}
function timestamp(value:string|undefined|null){
 if(!value||!Number.isFinite(Date.parse(value)))return missing;
 return new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+' (Brasília)';
}
export function BindingIdentity({binding:b}:{binding:Binding}){
 return <><strong>{b.customer_name||'Cliente não identificado nesta consulta'}</strong><br/>
 <span>{b.unit_name||'Unidade não identificada nesta consulta'} · Instalação {b.consumer_unit_number||'não informada'}</span></>;
}
export default function BindingEvidence({binding:b}:{binding:Binding}){
 const rows:[string,string][]=[
  ['Cliente',b.customer_name||missing],['CPF/CNPJ cadastrado',b.customer_document||missing],
  ['Unidade',b.unit_name||missing],['Instalação',b.consumer_unit_number||missing],
  ['Distribuidora',b.distributor||missing],['Ponto de medição',b.measurement_point],
  ['Perfil do cliente',b.profile_code],['Perfil principal da medição',b.principal_profile_code||missing],
  ['Representação',b.representation_kind==='TOTAL'?'Total':b.representation_kind==='PARTIAL'?'Parcial para os serviços informados':missing],
  ['Vigência inicial',documentaryDate(b.valid_from)],['Vigência final',b.valid_to?documentaryDate(b.valid_to):'Sem término informado'],
  ['Serviços cobertos',(b.service_scope||[]).map(s=>services[s]||s).join('; ')||missing],
  ['Base da medição',bases[b.measurement_basis]||missing],['Medidor',b.meter_code||'Não informado'],
  ['Autor da preparação (identificador auditado)',b.created_by||missing],['Registro desta revisão',timestamp(b.created_at)],
  ['Revisor (identificador auditado)',b.reviewed_by||'Ainda não registrado'],['Data da revisão',b.reviewed_at?timestamp(b.reviewed_at):'Ainda não registrada'],
 ];
 return <section aria-label="Evidências do vínculo CCEE">
  <h3>Cliente, unidade e representação · revisão {b.revision}</h3>
  {b.identity_complete!==true&&<Alert variant="error">Identificação cadastral incompleta. Reconfira o vínculo e atualize a consulta antes de aprovar.</Alert>}
  <p>Identificação consultada no cadastro atual da organização. A evidência e o histórico da preparação estão preservados abaixo.</p>
  <dl style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(230px,1fr))',gap:16}}>
   {rows.map(([label,value])=><div key={label} style={{minWidth:0}}><dt style={{fontWeight:600}}>{label}</dt><dd style={{margin:0,overflowWrap:'anywhere',whiteSpace:'pre-wrap'}}>{value}</dd></div>)}
  </dl>
  <h3>Evidência preservada</h3><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{b.evidence_reference||'Evidência não disponível. Reconfira a consulta antes de decidir.'}</p>
  <h3>Justificativa desta revisão</h3><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{b.revision_reason||'Não localizada no evento desta revisão. Consulte o histórico antes de decidir.'}</p>
  <Alert>Confirme que o ponto pertence à instalação indicada. A base de perdas deve permanecer a conferir enquanto não houver comprovação. O autor não pode aprovar a própria preparação.</Alert>
 </section>;
}
