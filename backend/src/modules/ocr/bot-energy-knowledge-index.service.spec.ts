import {regulatoryChunks} from './bot-energy-knowledge-index.service';
import {knowledgeTextHash} from './bot-energy-knowledge';
describe('Regulatory indexing boundaries',()=>{
 it('preserves every character, page and section with deterministic hashes',()=>{const text='Art. 1. '+ 'Regra oficial. '.repeat(700);const pages=[{page:1,section:'Artigos iniciais',text},{page:2,section:'Anexo',text:'Outro texto.'}];const chunks=regulatoryChunks(pages);expect(chunks.filter(c=>c.page===1).map(c=>c.content).join('')).toBe(text.trim());expect(chunks.every(c=>c.content.length<=2800&&c.content_hash===knowledgeTextHash(c.content))).toBe(true);expect(chunks).toEqual(regulatoryChunks(pages));expect(chunks.at(-1)?.section).toBe('Anexo');});
 it('does not index missing content or page/section provenance',()=>{expect(()=>regulatoryChunks([])).toThrow();expect(()=>regulatoryChunks([{page:0,section:'Artigo',text:'Texto'}])).toThrow();expect(()=>regulatoryChunks([{page:1,section:'',text:'Texto'}])).toThrow();});
});
