import {AzureKnowledgeEmbeddingsConnector,knowledgeEmbeddingConfig} from './azure-knowledge-embeddings.connector';

const config={enabled:true,organizations:['org-a'],endpoint:'https://example.openai.azure.com/',key:'synthetic-test-key',deployment:'bot-energy-knowledge-embeddings'};
const response=()=>({model:'text-embedding-3-small',data:[{index:0,embedding:Array(1536).fill(0.1)}],usage:{prompt_tokens:12,total_tokens:12}});
describe('Azure regulatory embeddings transport',()=>{
 it('uses a separate deployment and remains disabled by default',()=>{
  expect(knowledgeEmbeddingConfig({AZURE_OPENAI_DEPLOYMENT:'chat'}).deployment).toBeUndefined();
  expect(knowledgeEmbeddingConfig({AZURE_OPENAI_EMBEDDING_DEPLOYMENT:config.deployment}).enabled).toBe(false);
 });
 it('sends the pinned dimensions and captures usage for the budget ledger',async()=>{
  const send=jest.fn(async()=>new Response(JSON.stringify(response())));
  const r=await new AzureKnowledgeEmbeddingsConnector(config,send as typeof fetch).embed('org-a',['Texto sintético.']);
  expect(r.dimensions).toBe(1536);expect(r.inputTokens).toBe(12);
  const [url,request]=(send.mock.calls as any[][])[0];
  expect(url.pathname).toBe('/openai/v1/embeddings');
  expect(JSON.parse(request.body)).toMatchObject({model:config.deployment,dimensions:1536,encoding_format:'float'});
 });
 it('blocks other organizations before transmission',async()=>{
  const send=jest.fn();await expect(new AzureKnowledgeEmbeddingsConnector(config,send).embed('other',['Texto'])).rejects.toThrow('NOT_CONFIGURED');expect(send).not.toHaveBeenCalled();
 });
 it('blocks oversized input before transmission',async()=>{
  const send=jest.fn();await expect(new AzureKnowledgeEmbeddingsConnector(config,send).embed('org-a',['x'.repeat(6001)])).rejects.toThrow('CONTEXT_LIMIT');expect(send).not.toHaveBeenCalled();
 });
 it.each(['dimensions','model','usage','zero'])('rejects incompatible %s',async(kind)=>{
  const body=response();
  if(kind==='dimensions')body.data[0].embedding.pop();
  if(kind==='model')body.model='other-model';
  if(kind==='usage')body.usage.total_tokens=13;
  if(kind==='zero')body.data[0].embedding.fill(0);
  const send=jest.fn(async()=>new Response(JSON.stringify(body)));
  await expect(new AzureKnowledgeEmbeddingsConnector(config,send as typeof fetch).embed('org-a',['Texto'])).rejects.toThrow('INVALID_RESPONSE');
 });
});
