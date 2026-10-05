import {authorizedKnowledgeIndexer,regulatoryChunks} from './bot-energy-knowledge-index.service';
import {knowledgeTextHash} from './bot-energy-knowledge';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
describe('Knowledge ingestion authorization',()=>{
 const tenant=():TenantContext=>({organizationId:'org',userId:'actor',email:'admin@example.com',roleId:'role',role:'admin_platform',scope:'organization',accessMode:'platform_operation',permissions:[P.INTELLIGENCE_AI_USE]});
 it('accepts platform operation only with an explicitly selected organization and AI permission',()=>{expect(authorizedKnowledgeIndexer(tenant())).toBe(true);for(const changes of [{scope:'global'},{scope:undefined},{organizationId:''},{accessMode:undefined},{permissions:[]},{role:'consulta'},{role:'operacional'}])expect(authorizedKnowledgeIndexer({...tenant(),...changes} as TenantContext)).toBe(false);});
 it.each(['gestor','admin_org'])('preserves organization manager ingestion for %s',role=>{expect(authorizedKnowledgeIndexer({...tenant(),role,accessMode:undefined})).toBe(true);});
});
describe('Regulatory indexing boundaries',()=>{
 it('preserves every character, page and section with deterministic hashes',()=>{const text='Art. 1. '+ 'Regra oficial. '.repeat(700);const pages=[{page:1,section:'Artigos iniciais',text},{page:2,section:'Anexo',text:'Outro texto.'}];const chunks=regulatoryChunks(pages);expect(chunks.filter(c=>c.page===1).map(c=>c.content).join('')).toBe(text.trim());expect(chunks.every(c=>c.content.length<=2800&&c.content_hash===knowledgeTextHash(c.content))).toBe(true);expect(chunks).toEqual(regulatoryChunks(pages));expect(chunks.at(-1)?.section).toBe('Anexo');});
 it('does not index missing content or page/section provenance',()=>{expect(()=>regulatoryChunks([])).toThrow();expect(()=>regulatoryChunks([{page:0,section:'Artigo',text:'Texto'}])).toThrow();expect(()=>regulatoryChunks([{page:1,section:'',text:'Texto'}])).toThrow();});
});
