'use client';
type Evidence={version:number;observations?:string[];documents?:{documentId:string;sourceHash:string;contractId:string;annex:{state:string;reason?:string;price?:string|null;index?:string|null;modulation?:string|null;volumeTerms?:{hours:number;contractedMwh:string;minPercent:string;maxTolerancePercent:string}|null;pending?:string[];sources?:{page:number;sectionHash:string}[]};conflicts?:string[]}[]};
export default function SourcePreparationEvidence({data}:{data?:Evidence|null}){
 if(!data)return null;
 return <details><summary>EVA · fontes e condições do contrato</summary>
  {(data.observations??[]).map((s,i)=><p key={i}>{s}</p>)}
  {(data.documents??[]).map(d=><section key={d.documentId} aria-label='Anexo contratual para conferência'>
   <p>Documento {d.documentId} · contrato {d.contractId}</p>
   {d.annex.price?<p>Preço-base anual: R$ {d.annex.price}/MWh. O preço final depende dos reajustes comprovados.</p>:null}
   {d.annex.volumeTerms?<p>Volume: {d.annex.volumeTerms.contractedMwh} MWh ({d.annex.volumeTerms.hours} horas na competência). Limite inferior: {d.annex.volumeTerms.minPercent}%. Tolerância superior: {d.annex.volumeTerms.maxTolerancePercent}%.</p>:null}
   {d.annex.modulation?<p>Modulação: {d.annex.modulation}.</p>:null}
   {d.annex.index?<p>Índice previsto: {d.annex.index}. Nenhum percentual foi presumido.</p>:null}
   {d.annex.reason?<p>{d.annex.reason}</p>:null}
   {[...(d.conflicts??[]),...(d.annex.pending??[])].map((s,i)=><p key={i}>{s}</p>)}
   <p>Fonte: SHA-256 <code>{d.sourceHash}</code>{(d.annex.sources??[]).map(s=>' · página '+s.page).join('')}. Vínculo e condições para conferência; sem alteração automática do contrato.</p>
  </section>)}
 </details>;
}
