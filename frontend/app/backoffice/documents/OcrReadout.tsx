'use client';
import {useEffect,useRef,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
type Stats={total:number;known:number;missing:number;low:number;review:number;high:number;minimum:number|null;mean:number|null};
export type ReadoutSummary={pages:number[];fieldConfidence:Stats;criticalConfidence:Stats&{complete:boolean;minimumAll:number|null;matched:number};fieldsTruncated:boolean};
type Evidence={text:string;confidence:number|null;pages:number[];sourceVerified:boolean};
type Row=Evidence&{id:string;label?:string;key?:Evidence;value?:Evidence;table?:number;row?:number;cells?:(Evidence&{id:string;column:number;columnSpan:number;rowSpan:number})[]};
type Result={section:string;page:number;total:number;offset:number;nextOffset:number|null;previousOffset:number|null;truncated:boolean;text:string;rows:Row[]};
const pct=(c:number|null)=>c===null?'Não informada':(c*100).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%';
const band=(c:number|null)=>c===null?'Sem confiança informada':c<.45?'Baixa — bloqueia automação':c<=.85?'Revisão necessária':'Alta — depende das demais conferências';
const fieldNames:Record<string,string>={CustomerName:'Empresa',CustomerTaxId:'CNPJ do cliente',CustomerAddress:'Endereço do cliente',InvoiceId:'Número da fatura',InvoiceDate:'Emissão',InvoiceTotal:'Total da fatura',TotalTax:'Total de tributos',SubTotal:'Subtotal',AmountDue:'Valor a pagar',ServiceAddress:'Endereço da unidade',BillingAddress:'Endereço de cobrança',ServiceStartDate:'Início do período',ServiceEndDate:'Fim do período',DueDate:'Vencimento',VendorName:'Distribuidora',VendorTaxId:'CNPJ da distribuidora',Description:'Descrição',Quantity:'Quantidade',Unit:'Unidade de medida',UnitPrice:'Tarifa / preço unitário',Amount:'Valor',Tax:'Tributo',TaxRate:'Alíquota',ProductCode:'Código',Date:'Data'};
function fieldLabel(path=''){const name=path.split('.').pop()??path,item=/Items\[(\d+)\]/.exec(path);return (item?'Item '+(Number(item[1])+1)+' · ':'')+(fieldNames[name]??name);}
const box={border:'1px solid #40516b',borderRadius:10,padding:12,margin:'10px 0'};
function Value({value}:{value:Evidence}){const c=value.text.trim()?value.confidence:null;return <div><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{value.text||'Não identificado'}</p><small>Confiança: {pct(c)} · {band(c)}{value.pages.length?' · Página(s) '+value.pages.join(', '):' · Página não identificada'}</small><p><small>{value.sourceVerified?'Texto localizado na fonte OCR':'Localização do trecho requer conferência'}</small></p></div>;}
export default function OcrReadout({id,summary}:{id:string;summary:ReadoutSummary}){
 const dialog=useRef<HTMLDialogElement>(null),request=useRef(0);
 const [page,setPage]=useState(summary.pages[0]??0),[section,setSection]=useState('fields'),[data,setData]=useState<Result|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>()=>{request.current++;},[id]);
 async function load(p:number,s:string,offset=0){const version=++request.current;setBusy(true);setError('');setData(null);try{const next=await apiRequest<Result>('/api/v1/documents/'+encodeURIComponent(id)+'/ocr/readout?page='+p+'&section='+s+'&offset='+offset);if(version===request.current)setData(next);}catch{if(version===request.current)setError('Não foi possível consultar os dados técnicos. Tente novamente.');}finally{if(version===request.current)setBusy(false);}}
 const critical=summary.criticalConfidence,fields=summary.fieldConfidence;
 return <section aria-label="Confiança da leitura técnica" style={box}>
  <strong>Confiança e conferência</strong>
  <p>Aprovação automática: <strong>não</strong>. A extração requer conferência e ainda não alimenta o cálculo.</p>
  <p>Identificação e período: confiança disponível em {critical.known} de {critical.total} campos essenciais; {critical.matched} compatíveis com o cadastro.</p>
  <p>Menor confiança dos campos essenciais: <strong>{critical.complete?pct(critical.minimumAll):'indeterminada — há campos sem confiança'}</strong>.</p>
  <p>Campos técnicos reconhecidos: {fields.total}. Alta: {fields.high} · Revisão: {fields.review} · Baixa: {fields.low} · Sem confiança: {fields.missing}.</p>
  <button type="button" onClick={()=>{dialog.current?.showModal();void load(page,section);}}>Ver informações técnicas da fatura</button>
  <dialog ref={dialog} onClose={()=>{request.current++;setBusy(false);setData(null);}} style={{width:'min(1100px,94vw)',maxHeight:'90vh',overflowY:'auto',background:'#121d30',color:'#f0f5ff',border:'1px solid #536984',borderRadius:14,padding:24}} aria-label="Informações técnicas da fatura">
   <div style={{display:'flex',justifyContent:'space-between',gap:16}}><h2>Informações técnicas da fatura</h2><button type="button" onClick={()=>dialog.current?.close()}>Fechar</button></div>
   <p>Energia, consumo, demanda, valores, encargos, tarifas, período e identificação. Campanhas e atendimento ficam fora desta seleção. Consulte o arquivo original para o conteúdo integral.</p>
   <p>Confiança abaixo de 45%: bloqueio; de 45% a 85%: revisão; acima de 85%: apto à conferência automática, somente se as demais validações passarem. Confiança não mede a precisão comprovada.</p>
   <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
    <label>Página <select value={page} onChange={e=>{const p=Number(e.target.value);setPage(p);void load(p,section);}}>{summary.pages.map(p=><option key={p} value={p}>Página {p}</option>)}<option value={0}>{section==='text'?'Trechos de todas as páginas':'Campos sem página identificada'}</option></select></label>
    <label>Visualização <select value={section} onChange={e=>{setSection(e.target.value);void load(page,e.target.value);}}><option value="fields">Campos reconhecidos</option><option value="pairs">Rótulos e valores da fatura</option><option value="tables">Tabelas técnicas</option><option value="text">Trechos técnicos</option></select></label>
   </div>
   <p>Dados extraídos, ainda não aprovados. Um campo pode estar no texto ou na tabela e ainda não estar mapeado para o cálculo. A seleção por termos pode omitir trechos; ela não altera o original.</p>
   {busy&&<p role="status">Carregando informações…</p>}
   {error&&<p role="alert">{error} <button type="button" onClick={()=>void load(page,section)}>Tentar novamente</button></p>}
   {data&&<><p>{data.section==='text'?data.total+' caracteres selecionados':data.total+' registros selecionados'} · Página {data.page||'não atribuída / conjunto'}</p>
    {data.truncated&&<p role="alert">O limite de campos desta visualização foi atingido. Consulte o arquivo original.</p>}
    {data.section==='text'?<pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontFamily:'inherit'}}>{data.text||'Nenhum trecho técnico reconhecido nesta seleção.'}</pre>:data.rows.length?data.rows.map(row=><article key={row.id} style={box}>
     {row.cells?<><strong>Tabela {row.table} · Linha {row.row}</strong><div style={{display:'flex',gap:16,overflowX:'auto'}}>{row.cells.map(cell=><div key={cell.id} style={{minWidth:140,flex:1}}><strong>Coluna {cell.column+1}{cell.columnSpan>1?' a '+(cell.column+cell.columnSpan):''}</strong><Value value={cell}/></div>)}</div></>:row.key&&row.value?<><strong>{row.key.text}</strong><Value value={row.value}/></>:<><strong style={{overflowWrap:'anywhere'}}>{fieldLabel(row.label)}</strong><Value value={row}/></>}
    </article>):<p>Nenhum campo técnico reconhecido nesta seleção. Verifique as demais páginas e visualizações.</p>}
    <div style={{display:'flex',gap:12}}><button type="button" disabled={data.previousOffset===null} onClick={()=>void load(page,section,data.previousOffset??0)}>Anterior</button><button type="button" disabled={data.nextOffset===null} onClick={()=>void load(page,section,data.nextOffset??0)}>Próximos registros</button></div>
   </>}
  </dialog>
 </section>;
}
