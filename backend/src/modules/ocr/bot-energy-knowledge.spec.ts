import {KnowledgeChunk,KnowledgeQuery,knowledgeTextHash,officialKnowledgeUrl,selectKnowledge} from './bot-energy-knowledge';

const query:KnowledgeQuery={periodStart:'2026-08-01',periodEnd:'2026-08-31',market:'ACL',embeddingModel:'text-embedding-3-small',embeddingVersion:'1'};
const chunk=(extra:Partial<KnowledgeChunk>={}):KnowledgeChunk=>({id:'chunk-1',documentId:'ren1000',family:'REN_1000',authority:'ANEEL',title:'REN 1000',officialUrl:'https://www2.aneel.gov.br/cedoc/ren20211000.pdf',version:'rev-conferida',section:'Artigo de teste',page:1,text:'Texto sintético para teste, não é legislação.',textHash:knowledgeTextHash('Texto sintético para teste, não é legislação.'),documentHash:'a'.repeat(64),validFrom:'2022-01-03',validTo:null,verifiedAt:'2026-10-04T00:00:00Z',reviewedBy:'editor',status:'REVIEWED',markets:['COMMON'],similarity:0.9,embeddingModel:query.embeddingModel,embeddingVersion:query.embeddingVersion,...extra});
describe('Regulatory knowledge boundary',()=>{
 it('retrieves reviewed, applicable evidence with its revision and source',()=>expect(selectKnowledge([chunk()],query).state).toBe('READY'));
 it.each(['https://www2.aneel.gov.br.evil.test/x','http://www2.aneel.gov.br/x','https://user:password@www2.aneel.gov.br/x','https://www.gov.br/other/x','https://127.0.0.1/x'])('rejects unsafe official source %s',url=>expect(officialKnowledgeUrl('ANEEL',url)).toBe(false));
 it.each<Partial<KnowledgeChunk>>([{status:'DRAFT'},{status:'QUARANTINED'},{textHash:'b'.repeat(64)},{documentHash:'missing'},{reviewedBy:''},{verifiedAt:'invalid'},{validFrom:'2026-09-01'},{validTo:'2026-08-01'},{markets:['GD']},{similarity:0.3},{embeddingVersion:'different'}])('does not retrieve invalid or out-of-scope evidence %j',extra=>expect(selectKnowledge([chunk(extra)],query).state).toBe('NO_EVIDENCE'));
 it('preserves historical applicability instead of using latest automatically',()=>expect(selectKnowledge([chunk({validTo:'2026-09-01'}),chunk({id:'new',version:'new',validFrom:'2026-09-01'})],query).chunks.map(c=>c.id)).toEqual(['chunk-1']));
 it('abstains when a revision starts during the invoice competence',()=>expect(selectKnowledge([chunk({validTo:'2026-08-15'}),chunk({id:'new',version:'new',validFrom:'2026-08-15'})],query).state).toBe('VERSION_CONFLICT'));
 it('abstains on overlapping revisions of the same document',()=>expect(selectKnowledge([chunk(),chunk({id:'new',version:'new'})],query).state).toBe('VERSION_CONFLICT'));
 it('rejects impossible dates',()=>expect(()=>selectKnowledge([],{...query,periodStart:'2026-02-30'})).toThrow('INVALID_KNOWLEDGE_PERIOD'));
});
