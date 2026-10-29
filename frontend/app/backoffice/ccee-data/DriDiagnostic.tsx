'use client';
const names:Record<string,string>={DRI_EVENTS:'Catálogo de eventos',DRI_REPORTS:'Catálogo de relatórios e quadros',DRI_RESULTS:'Resultados do quadro'};
export function driCause(code:string){
 if(['DRI_EVENT_IDENTITY_CONFLICT','DRI_EVENT_IDENTITY_REVIEW','DRI_DUPLICATE_ROW'].includes(code))return 'Interpretação local: a CCEE retornou registros cuja identidade precisa ser conferida. Isso não comprova falha de autorização nem inconsistência na CCEE.';
 if(['TIMEOUT','TRANSPORT_ERROR','TRUNCATED_RESPONSE'].includes(code))return 'Comunicação não concluída. Confira a disponibilidade do serviço e o protocolo desta tentativa antes de repetir.';
 if(code==='PROVIDER_REJECTED')return 'Requisição rejeitada pelo serviço. Informe à CCEE o serviço, os parâmetros de seleção e o transaction ID; o HTTP isolado não determina a causa.';
 if(['REPORT_SELECTION_REVIEW','FRAME_SELECTION_REVIEW','DRI_REPORT_MISMATCH'].includes(code))return 'Seleção de fonte: confira os relatórios, versões e quadros oferecidos para este evento e perfil. A ausência neste recorte não significa que toda a API esteja indisponível.';
 if(code==='DRI_PARTICIPANT_PROOF_REQUIRED')return 'Validação local de escopo: a resposta não contém uma coluna única CNPJ DO AGENTE. É necessário comprovar a coluna de identificação antes de incorporar valores.';
 if(code==='DRI_PARTICIPANT_MISMATCH')return 'A identificação do participante na resposta não corresponde ao vínculo autorizado. A incorporação foi interrompida para preservar o escopo.';
 if(['DRI_PARAMETERS_REQUIRE_REVIEW','DRI_CATALOG_REQUIRES_REVIEW','DRI_SCHEMA_REQUIRES_REVIEW','DRI_CSV_REQUIRES_REVIEW'].includes(code))return 'Leiaute ou parâmetros exigem revisão local. Confira o catálogo e a versão efetivamente retornados; não é evidência de falha geral da conexão.';
 if(['DRI_COVERAGE_INCOMPLETE','DRI_PAGINATION_CHANGED','DRI_PAGINATION_LIMIT_OR_MISSING'].includes(code))return 'A paginação ou a contagem das linhas não comprovou cobertura integral. A leitura foi preservada sem converter uma parte em resultado completo.';
 if(['ACCESS_CHANGED','ACCESS_REVOKED','DRI_BINDING_REQUIRED'].includes(code))return 'O escopo de representação ou acesso mudou. Confira o vínculo autorizado antes de consultar dados privados.';
 if(code==='BUDGET_EXHAUSTED')return 'O limite de requisições foi atingido; os dados já recebidos foram preservados.';
 return 'Consulta exige conferência da etapa indicada. Preserve o histórico antes de repetir; não trate dados ausentes como zero.';
}
export default function DriDiagnostic({snapshot}:{snapshot:any}){
 const j=snapshot?.job;if(!j)return null;
 const selection=j.request_payload??{},proof=snapshot.provenance??{},d=snapshot.diagnostic;
 const available=j.state==='SUCCEEDED',running=['QUEUED','RUNNING'].includes(j.state),date=j.finished_at??j.created_at;
 const paths=d?.version===1&&d.stage==='EVENT_IDENTITY'&&Array.isArray(d.changedPaths)?d.changedPaths.slice(0,16).filter((x:any)=>typeof x==='string'):[];
 return <section aria-label='Diagnóstico da consulta CCEE' style={{padding:12,border:'1px solid #55718a',borderRadius:8,overflowWrap:'anywhere'}}>
  <h4>{names[j.kind]??'Consulta CCEE'} · {j.state}</h4>
  <p>{date?new Date(date).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'Horário não registrado'} · horário de Brasília · competência {String(j.month??'').slice(0,7)}</p>
  {available?<p>Fonte recebida. A classificação de rubricas e a competência de desembolso devem ser comprovadas separadamente.</p>:running?<p>Consulta registrada ou em execução; aguarde o resultado desta mesma solicitação.</p>:<p>{driCause(j.error_code??'')}</p>}
  <dl><dt>Etapa / código</dt><dd>{names[j.kind]??j.kind} · {j.error_code??'Sem erro registrado'}</dd><dt>Seleção</dt><dd>Evento {selection.eventCode??'a listar'} · relatório {selection.reportId??'a selecionar no catálogo'} · quadro {selection.frameId??'a selecionar no catálogo'}</dd><dt>HTTP</dt><dd>{proof.httpStatus??'Não registrado nesta evidência'}{proof.httpStatus===200&&!available?' · resposta recebida; validação local interrompida':''}</dd></dl>
  {Array.isArray(proof.transactions)&&proof.transactions.length?<p>Transaction ID: {proof.transactions.slice(0,10).join(' · ')}</p>:null}
  {Array.isArray(proof.hashes)&&proof.hashes.length?<details><summary>Hashes das respostas preservadas</summary>{proof.hashes.slice(0,10).map((h:string)=><p key={h}>{h}</p>)}</details>:null}
  {paths.length?<><p>Evento com identidade divergente: {d.eventCode}. Campos diferentes: {paths.join(', ')}.</p><p>Os valores desses campos e o XML não são exibidos neste diagnóstico. Confirmar a chave oficial da divulgação antes de retomar.</p>{d.truncated?<p>Lista de campos limitada; diagnóstico preservado para conferência.</p>:null}</>:j.error_code==='DRI_EVENT_IDENTITY_CONFLICT'?<p>Esta tentativa histórica não registrou os campos divergentes. Uma reprodução diagnóstica autorizada é necessária para identificá-los.</p>:null}
 </section>;
}
