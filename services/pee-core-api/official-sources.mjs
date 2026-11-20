import https from 'node:https';
import {lookup as dnsLookup} from 'node:dns/promises';
import {BlockList,isIP} from 'node:net';
import {createHash} from 'node:crypto';

export const distributors=Object.freeze([
 {id:'cpfl',name:'CPFL Energia',url:'https://www2.grupocpfl.com.br/eficiencia-energetica/chamada-publica-energia',hosts:['www2.grupocpfl.com.br','www.grupocpfl.com.br'],channel:'CPP',note:'Identifique a concessionária da UC no edital: o grupo reúne concessionárias diferentes.'},
 {id:'neoenergia',name:'Neoenergia',url:'https://www.neoenergia.com/pt/eficiencia-energetica/projetos-de-chamada-publica',hosts:['www.neoenergia.com','acessodigital.neoenergia.com'],channel:'CPP',note:'Confira a chamada específica da concessionária e as retificações.'},
 {id:'energisa',name:'Energisa',url:'https://www.energisa.com.br/',hosts:['www.energisa.com.br'],channel:'Portal institucional',note:'Localize a chamada da concessionária responsável pela unidade.'},
 {id:'equatorial',name:'Equatorial',url:'https://equatorial.gestaocpp.com.br/',hosts:['equatorial.gestaocpp.com.br'],channel:'Portal CPP',note:'Confira estado, concessionária e edição antes de vincular o projeto.'},
 {id:'edp',name:'EDP',url:'https://www.edp.com.br/',hosts:['www.edp.com.br'],channel:'Portal institucional',note:'Localize o edital correspondente à área de concessão da UC.'},
 {id:'enel',name:'Enel',url:'https://www.enel.com.br/',hosts:['www.enel.com.br','rj-cpp.enel.com'],channel:'Portal institucional',note:'As chamadas e canais variam conforme a concessionária.'},
 {id:'cemig',name:'Cemig',url:'https://www.cemig.com.br/chamada-publica/',hosts:['www.cemig.com.br'],channel:'Chamadas públicas',note:'Filtre Eficiência Energética; o portal também contém outros programas.'},
 {id:'light',name:'Light',url:'https://www.light.com.br/SitePages/home.aspx',hosts:['www.light.com.br'],channel:'Portal institucional',note:'Confirme edital, anexos e canal oficial de recebimento.'},
 {id:'copel',name:'Copel',url:'https://www.copel.com/site/',hosts:['www.copel.com'],channel:'Portal institucional',note:'Consulte as chamadas do Programa de Eficiência Energética.'},
 {id:'celesc',name:'Celesc',url:'https://pee.celesc.com.br/',hosts:['pee.celesc.com.br','www.celesc.com.br'],channel:'Portal PEE',note:'Confira a versão do edital e a unidade consumidora.'}
]);
export const officialSources=Object.freeze([
 {id:'aneel-cpp',name:'ANEEL · Chamadas Públicas',url:'https://www.gov.br/aneel/pt-br/assuntos/programa-de-eficiencia-energetica/chamadas-publicas',hosts:['www.gov.br'],pathPrefix:'/aneel/'},
 {id:'propee',name:'ANEEL · Procedimentos regulatórios',url:'https://www.gov.br/aneel/pt-br/centrais-de-conteudos/procedimentos-regulatorios/procedimentos-ee-ped',hosts:['www.gov.br'],pathPrefix:'/aneel/'},
 ...distributors.map(d=>({id:d.id,name:d.name+' · '+d.channel,url:d.url,hosts:d.hosts}))
]);
export const assistanceFields=Object.freeze({
 eligibility:{label:'Enquadramento e habilitação',terms:['consumidor','concessão','tipologia','elegibilidade','documental'],steps:['Identifique a UC, o beneficiário e a concessionária na fatura.','Confira tipologias, impedimentos e documentos no edital e em suas retificações.','Registre cada exigência no perfil do edital e vincule sua evidência no checklist.']},
 technical:{label:'Diagnóstico e recursos',terms:['diagnóstico','equipamentos','eficiência','energia','demanda'],steps:['Preencha inventário, fronteiras, horas e condições de operação.','Selecione as medidas simuladas e vincule os manuais dos equipamentos propostos.','Concilie quantidades, preços, fontes, vida útil, descarte e comprovação dos orçamentos.']},
 economic:{label:'Economia e RCB',terms:['custo','benefício','RCB','recursos','contrapartida'],steps:['Use os resultados das medidas selecionadas e os custos evitados aplicáveis.','Identifique se o edital avalia RCB total ou a parcela PEE.','Confira orçamento, vidas úteis, taxa, O&M e parâmetros oficiais; não copie limites históricos.']},
 mv:{label:'Medição e Verificação',terms:['medição','verificação','baseline','M&V','economia'],steps:['Defina fronteira, variáveis, instrumentos e períodos de baseline e pós-implantação.','Justifique a opção A, B, C ou D e o método de ajuste e cálculo da economia.','Distinga estratégia, plano e relatório de M&V; submeta o plano à revisão técnica.']},
 documents:{label:'Documentos e assinaturas',terms:['documentos','anexo','assinatura','diagnóstico','carta'],steps:['Confira a lista completa de anexos, formatos e assinaturas exigidos.','Anexe originais vinculados ao projeto e à medida correspondente.','Registre a evidência de assinatura GOV, firma reconhecida ou provedor aceito e peça conferência.']},
 selection:{label:'Pontuação e classificação',terms:['seleção','critérios','ranking','pontuação','propostas'],steps:['Cadastre pesos e métodos da versão vigente do edital.','Use referências da mesma chamada e tipologia quando houver comparação relativa.','Trate a nota como estimativa; classificação e aprovação dependem da banca, concorrência e orçamento.']},
 submission:{label:'Prazo e apresentação',terms:['prazo','propostas','submissão','edital','apresentação'],steps:['Confira data, horário, fuso e canal oficial na última retificação.','Revise pendências, relatórios, manuais e assinaturas antes da apresentação.','Guarde o protocolo e registre diligências e decisões no Fluxo da CPP.']},
 execution:{label:'Execução e acompanhamento',terms:['implantação','execução','resultados','verificação','contrato'],steps:['Vincule a decisão formal e as condições efetivamente aprovadas.','Acompanhe cronograma, entregáveis e documentos de execução.','Registre resultados medidos e ajustes com sua memória e evidências; não confunda previsão com medição.']}
});

// These are fixed source identifiers, never URLs or instructions supplied by the browser.
export function permittedSourceUrl(raw,source){
 const u=new URL(raw);if(u.protocol!=='https:'||u.port&&u.port!=='443'||u.username||u.password||!source.hosts.includes(u.hostname)||source.pathPrefix&&!u.pathname.startsWith(source.pathPrefix))throw Error('SOURCE_OUT_OF_SCOPE');
 return u;
}
const blocked=new BlockList();
for(const [address,prefix]of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])blocked.addSubnet(address,prefix,'ipv4');
const global6=new BlockList();global6.addSubnet('2000::',3,'ipv6');
const excluded6=new BlockList();for(const [a,p]of [['2001::',32],['2001:db8::',32],['2002::',16]])excluded6.addSubnet(a,p,'ipv6');
export function publicAddress(address){const family=isIP(address);return family===4?!blocked.check(address,'ipv4'):family===6&&global6.check(address,'ipv6')&&!excluded6.check(address,'ipv6');}
export async function readOfficialSource(source,{lookup=dnsLookup,request=https.get,maxBytes=2000000}={}){
 async function read(raw,depth=0){
  const u=permittedSourceUrl(raw,source);if(depth>3)throw Error('SOURCE_REDIRECT_LIMIT');
  const addresses=await lookup(u.hostname,{all:true,verbatim:true});if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw Error('SOURCE_PRIVATE_ADDRESS');
  return new Promise((resolve,reject)=>{
   const pinned=addresses[0];const req=request(u,{family:pinned.family,autoSelectFamily:false,headers:{'User-Agent':'EnergyOS-PEE-EVA/1.0 (official-source field assistance)','Accept':'text/html,application/xhtml+xml','Accept-Encoding':'identity'},lookup:(host,options,cb)=>cb(null,pinned.address,pinned.family),timeout:8000},response=>{
    if([301,302,303,307,308].includes(response.statusCode)){const next=response.headers.location;response.resume();if(!next)return reject(Error('SOURCE_REDIRECT_INVALID'));try{permittedSourceUrl(new URL(next,u),source);}catch(e){return reject(e);}read(new URL(next,u),depth+1).then(resolve,reject);return;}
    if(response.statusCode!==200){response.resume();return reject(Error('SOURCE_HTTP_'+response.statusCode));}
    if(!/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(response.headers['content-type']??'')||response.headers['content-encoding']&&response.headers['content-encoding']!=='identity'){response.resume();return reject(Error('SOURCE_FORMAT_UNSUPPORTED'));}
    let size=0;const parts=[];response.on('data',part=>{size+=part.length;if(size>maxBytes){response.destroy();reject(Error('SOURCE_SIZE_LIMIT'));}else parts.push(part);});response.on('error',()=>reject(Error('SOURCE_READ_FAILED')));response.on('end',()=>resolve({url:u.href,bytes:Buffer.concat(parts),retrieved_at:new Date().toISOString()}));
   });req.on('timeout',()=>req.destroy(Error('SOURCE_TIMEOUT')));req.on('error',()=>reject(Error('SOURCE_UNAVAILABLE')));
  });
 }
 return read(source.url);
}
export function plainSource(html){
 const cleaned=String(html).replace(/<!--[\s\S]*?-->/g,' ').replace(/<(script|style|nav|footer|header|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ');
 const main=cleaned.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i)?.[1]??cleaned;
 return main.replace(/<[^>]*>/g,' ').replace(/&(?:nbsp|amp|lt|gt|quot|apos);/g,x=>({'&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[x])).replace(/&#(x[0-9a-f]+|\d+);/gi,(_,v)=>{const n=v[0].toLowerCase()==='x'?parseInt(v.slice(1),16):Number(v);return n>0&&n<0x110000?String.fromCodePoint(n):' ';}).replace(/\s+/g,' ').trim().slice(0,400000);
}
const normalized=s=>String(s).normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase('pt-BR');
export function sourceExcerpt(html,field,question=''){
 const body=plainSource(html),words=body.split(/\s+/),terms=[...assistanceFields[field].terms,...String(question).split(/\s+/).filter(t=>t.length>=4).slice(0,8)].map(normalized);let best=-1,index=-1;
 for(let i=0;i<words.length;i+=8){const window=normalized(words.slice(i,i+22).join(' ')),score=terms.reduce((n,t)=>n+Number(window.includes(t)),0);if(score>best&&score>0){best=score;index=i;}}
 return index<0?null:words.slice(index,index+22).join(' ');
}
export async function assistFromOfficialSources(input,{reader=readOfficialSource}={}){
 if(!input||!Object.hasOwn(assistanceFields,input.field)||!Array.isArray(input.source_ids)||input.source_ids.length<1||input.source_ids.length>3||new Set(input.source_ids).size!==input.source_ids.length)throw Error('EVA_INPUT_INVALID');
 const chosen=input.source_ids.map(id=>officialSources.find(s=>s.id===id));if(chosen.some(s=>!s))throw Error('EVA_SOURCE_INVALID');
 const question=String(input.question??'').trim();if(question.length>1000||/senha|credencial|\btoken\b|ignore.{0,30}(instru|regra)|execute|liber.{0,20}acesso|fa[çc]a.{0,15}pagamento/i.test(question))throw Error('EVA_OUT_OF_SCOPE');
 const results=await Promise.all(chosen.map(async source=>{try{const r=await reader(source),excerpt=sourceExcerpt(r.bytes.toString('utf8'),input.field,question);return {source_id:source.id,name:source.name,url:r.url,retrieved_at:r.retrieved_at,sha256:createHash('sha256').update(r.bytes).digest('hex'),status:excerpt?'excerpt':'no_matching_excerpt',excerpt};}catch{return {source_id:source.id,name:source.name,url:source.url,status:'unavailable',excerpt:null};}}));
 return {mode:'official_retrieval',field:input.field,label:assistanceFields[input.field].label,steps:assistanceFields[input.field].steps,sources:results,requires_human_review:true,can_apply:false,notice:'Consulta orientada por campo. As citações vêm das páginas oficiais consultadas; o roteiro é orientação da plataforma. Não interpreta automaticamente PDF, não altera o projeto e não determina aprovação.'};
}
