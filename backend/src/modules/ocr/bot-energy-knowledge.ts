import {createHash} from 'node:crypto';

export type KnowledgeAuthority='ANEEL'|'PLANALTO'|'CCEE'|'ONS';
export type KnowledgeFamily='ANEEL_RULES'|'REN_1000'|'REN_1059'|'LAW_14300'|'PRODIST'|'CCEE_PROCEDURES'|'ONS_PROCEDURES';
export type EnergyMarket='COMMON'|'ACL'|'ACR'|'GD';

// Discovery only. A URL is not an indexed document, nor proof of the applicable rule.
export const knowledgeCatalogue:ReadonlyArray<{family:KnowledgeFamily;authority:KnowledgeAuthority;title:string;url:string}>=[
 {family:'ANEEL_RULES',authority:'ANEEL',title:'Regras ANEEL',url:'https://www.gov.br/aneel/pt-br'},
 {family:'REN_1000',authority:'ANEEL',title:'REN 1.000/2021',url:'https://www2.aneel.gov.br/cedoc/ren20211000.pdf'},
 {family:'REN_1059',authority:'ANEEL',title:'REN 1.059/2023',url:'https://www2.aneel.gov.br/cedoc/ren20231059.pdf'},
 {family:'LAW_14300',authority:'PLANALTO',title:'Lei 14.300/2022',url:'https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2022/lei/l14300.htm'},
 {family:'PRODIST',authority:'ANEEL',title:'PRODIST',url:'https://www.gov.br/aneel/pt-br/centrais-de-conteudos/procedimentos-regulatorios/prodist'},
 {family:'CCEE_PROCEDURES',authority:'CCEE',title:'Procedimentos de Comercialização',url:'https://www.ccee.org.br/en/web/guest/mercado/procedimentos-de-comercializacao'},
 {family:'ONS_PROCEDURES',authority:'ONS',title:'Procedimentos de Rede',url:'https://www.ons.org.br/paginas/sobre-o-ons/procedimentos-de-rede/vigentes'},
];

const hosts:Record<KnowledgeAuthority,ReadonlyArray<string>>={
 ANEEL:['www.gov.br','www.aneel.gov.br','www2.aneel.gov.br','biblioteca.aneel.gov.br','git.aneel.gov.br'],
 PLANALTO:['www.planalto.gov.br','planalto.gov.br'],
 CCEE:['www.ccee.org.br','ccee.org.br'],
 ONS:['www.ons.org.br','ons.org.br','ecmservice.ons.org.br','proxyportais.ons.org.br'],
};
export function officialKnowledgeUrl(authority:KnowledgeAuthority,value:string):boolean{
 try{
  const u=new URL(value);
  return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&hosts[authority]?.includes(u.hostname)===true&&
   (u.hostname!=='www.gov.br'||u.pathname.startsWith('/aneel/'));
 }catch{return false;}
}
export type KnowledgeChunk={
 id:string;documentId:string;family:KnowledgeFamily;authority:KnowledgeAuthority;title:string;
 officialUrl:string;version:string;section:string;page:number|null;text:string;textHash:string;
 documentHash:string;validFrom:string;validTo:string|null;verifiedAt:string;reviewedBy:string;
 status:'DRAFT'|'REVIEWED'|'QUARANTINED';markets:EnergyMarket[];similarity:number;
 embeddingModel:string;embeddingVersion:string;
};
export type KnowledgeQuery={periodStart:string;periodEnd:string;market:EnergyMarket;embeddingModel:string;embeddingVersion:string};
export type KnowledgeSelection={state:'READY'|'NO_EVIDENCE'|'VERSION_CONFLICT';chunks:KnowledgeChunk[]};
export const knowledgeTextHash=(text:string)=>createHash('sha256').update(text,'utf8').digest('hex');
const day=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;

// Defence in depth after database filtering. Similarity is relevance, never legal confidence.
// An historical revision may be REVIEWED: validity, not "latest", determines applicability.
export function selectKnowledge(chunks:KnowledgeChunk[],query:KnowledgeQuery):KnowledgeSelection{
 if(!day(query.periodStart)||!day(query.periodEnd)||query.periodStart>query.periodEnd)throw new Error('INVALID_KNOWLEDGE_PERIOD');
 const applicable=chunks.filter(c=>knowledgeCatalogue.some(s=>s.family===c.family&&s.authority===c.authority)&&
  c.status==='REVIEWED'&&officialKnowledgeUrl(c.authority,c.officialUrl)&&c.reviewedBy.trim()&&
  Number.isFinite(Date.parse(c.verifiedAt))&&c.version.trim()&&c.section.trim()&&c.text.trim()&&c.text.length<=6000&&
  /^[a-f0-9]{64}$/.test(c.documentHash)&&c.textHash===knowledgeTextHash(c.text)&&
  day(c.validFrom)&&(c.validTo===null||day(c.validTo)&&c.validTo>c.validFrom)&&
  c.validFrom<=query.periodEnd&&(c.validTo===null||c.validTo>query.periodStart)&&
  (c.markets.includes('COMMON')||c.markets.includes(query.market))&&
  c.embeddingModel===query.embeddingModel&&c.embeddingVersion===query.embeddingVersion&&
  Number.isFinite(c.similarity)&&c.similarity>=0.72&&c.similarity<=1);
 // A period crossing a revision needs a more precise date; don't silently pick either rule.
 if(applicable.some(c=>c.validFrom>query.periodStart||c.validTo!==null&&c.validTo<=query.periodEnd))return {state:'VERSION_CONFLICT',chunks:[]};
 const revisions=new Map<string,Set<string>>();
 for(const c of applicable){const r=revisions.get(c.documentId)??new Set<string>();r.add(c.version+':'+c.documentHash);revisions.set(c.documentId,r);}
 if([...revisions.values()].some(r=>r.size>1))return {state:'VERSION_CONFLICT',chunks:[]};
 const unique=[...new Map(applicable.map(c=>[c.id,c])).values()].sort((a,b)=>b.similarity-a.similarity||a.id.localeCompare(b.id)).slice(0,6);
 return {state:unique.length?'READY':'NO_EVIDENCE',chunks:unique};
}

export function knowledgeEvidence(chunk:KnowledgeChunk){
 return {id:'regulation-'+chunk.id,label:chunk.title+' · '+chunk.section,value:chunk.text,
  source:`${chunk.authority} · versão ${chunk.version} · vigência ${chunk.validFrom} até ${chunk.validTo??'sem término cadastrado'} · página ${chunk.page??'não paginada'} · hash ${chunk.documentHash}`};
}
