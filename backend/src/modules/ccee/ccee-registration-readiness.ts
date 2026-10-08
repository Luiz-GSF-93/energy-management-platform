export type CceeReadinessContext = {
 organizationId:string; checkedAt:string;
 record:{id:string;revision:number;status:string;operation:string;customer_id:string;consumer_unit_id:string;deadline:string};
 customerActive:boolean; agendaCurrent:boolean|null;
 representation:null|{id:string;revision:number;status:string;profileCode:string;independentReview:boolean};
};
// Documentary readiness is not provider authorization or transmission approval.
// No environment flag or caller-supplied "ready" value can enable remote writes.
export function registrationReadiness(context:CceeReadinessContext){
 const r=context.record,a=context.representation;
 if(!context.organizationId||!Number.isFinite(Date.parse(context.checkedAt))||!r||!Number.isInteger(r.revision)||r.revision<1||!['REGISTER_CONTRACT','VALIDATE_AMOUNTS'].includes(r.operation))throw new Error('CCEE_INVALID_READINESS');
 const check=(code:string,label:string,passed:boolean,detail:string)=>({code,label,status:passed?'CONFIRMED' as const:'PENDING' as const,detail});
 return {organizationId:context.organizationId,recordId:r.id,revision:r.revision,checkedAt:context.checkedAt,transmissionEnabled:false,providerVerified:false,
  profileCode:a?.profileCode??null,representationRevision:a?.revision??null,
  checks:[
   check('CUSTOMER_BINDING','Cliente e unidade ativos',context.customerActive,'Vínculo conferido na organização ativa.'),
   check('INDEPENDENT_REVIEW','Revisão interna',r.status==='APPROVED','A aprovação interna não representa registro ou validação na CCEE.'),
   check('DEADLINE','Prazo vigente',Date.parse(r.deadline)>Date.parse(context.checkedAt),'O prazo deve estar no futuro; conferir a agenda oficial para a operação.'),
   check('AGENDA','Prazo da agenda',context.agendaCurrent===true,context.agendaCurrent===null?'Prazo informado manualmente: confirmar no calendário oficial.':'A agenda vinculada deve permanecer aberta e manter o mesmo prazo.'),
   check('REPRESENTATION_DOCUMENT','Evidência registrada e revisada',!!a&&a.status==='APPROVED'&&a.independentReview,'Confere somente a última revisão interna. A vigência do instrumento e a autorização na CCEE ainda precisam ser verificadas.'),
   check('PROVIDER_AUTHORIZATION','Representação e papel na CCEE',false,'Confirmar o perfil do cliente, a representação operacional e o papel exigido: vendedor para registrar; comprador para validar. O perfil da Expert Energy não substitui o perfil do cliente.'),
   check('LAYOUT','Leiaute e arquivo exato',false,'Conferir o gerador e o XSD oficiais vigentes, os campos contratuais e montantes. Nenhum XML homologado foi produzido por esta conferência.'),
   check('PILOT','Homologação no ambiente piloto',false,'Validar com dados autorizados no piloto e consultar o resultado do processamento antes da liberação de produção.'),
   check('EXACT_APPROVAL','Aprovação do conteúdo de envio',false,'Aprovar o arquivo exato, seu hash e a representação vigente. Recuperar resultados incertos sem repetir automaticamente a transmissão.'),
  ],disclosure:'Conferência somente de leitura. Nenhum dado foi enviado à CCEE; pendências não são liberadas pela revisão interna.'};
}
