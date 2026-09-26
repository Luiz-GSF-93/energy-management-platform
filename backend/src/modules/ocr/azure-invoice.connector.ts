import { createHash } from 'node:crypto';
import { inspectDocument, DocumentFile } from '../documents/services/document-file';

export const AZURE_API_VERSION = '2024-11-30';
const MODEL = 'prebuilt-invoice';
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
export type OcrErrorCode = 'NOT_CONFIGURED' | 'INVALID_CONFIGURATION' | 'INVALID_DOCUMENT' | 'INVALID_OPERATION' | 'SUBMISSION_UNKNOWN' | 'RATE_LIMITED' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_REJECTED' | 'INVALID_RESPONSE';
export class OcrProviderError extends Error {
 constructor(readonly code: OcrErrorCode, readonly retryAfterSeconds?: number) { super(code); this.name = 'OcrProviderError'; }
}
export type AzureOperation = { url: string; retryAfterSeconds: number };
export type AzurePoll = { status: 'running'; retryAfterSeconds: number } | { status: 'succeeded'; result: Record<string, unknown> } | { status: 'failed' };
export interface AzureOcrConfig { enabled: boolean; endpoint?: string; key?: string; }
export function azureConfig(env: NodeJS.ProcessEnv): AzureOcrConfig {
 return { enabled: env.AZURE_DOCUMENT_INTELLIGENCE_ENABLED === 'true', endpoint: env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT, key: env.AZURE_DOCUMENT_INTELLIGENCE_KEY };
}
function endpointOf(config: AzureOcrConfig): URL {
 if (!config.enabled || !config.endpoint || !config.key) throw new OcrProviderError('NOT_CONFIGURED');
 let u: URL;
 try { u = new URL(config.endpoint); } catch { throw new OcrProviderError('INVALID_CONFIGURATION'); }
 if (u.protocol !== 'https:' || !/^[a-z0-9][a-z0-9-]*[.]cognitiveservices[.]azure[.]com$/.test(u.hostname) || u.port || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new OcrProviderError('INVALID_CONFIGURATION');
 return u;
}
function retryAfter(response: Response): number {
 const value = response.headers.get('retry-after');
 const seconds = value && /^[0-9]+$/.test(value) ? Number(value) : value ? Math.ceil((Date.parse(value) - Date.now()) / 1000) : 5;
 return Number.isFinite(seconds) ? Math.min(3600, Math.max(1, seconds)) : 5;
}
// One request per method: a durable worker must persist the operation before polling.
// No automatic POST retry: a lost response may already have incurred a charge.
export class AzureInvoiceConnector {
 constructor(private readonly config: AzureOcrConfig, private readonly transport: typeof fetch = fetch) {}
 isConfigured(): boolean { try { endpointOf(this.config); return true; } catch { return false; } }
 private operationUrl(value: string): URL {
  const root = endpointOf(this.config);
  let url: URL;
  try { url = new URL(value); } catch { throw new OcrProviderError('INVALID_OPERATION'); }
  const path = new RegExp("^/documentintelligence/documentModels/prebuilt-invoice/analyzeResults/[a-zA-Z0-9-]+$");
  if (url.origin !== root.origin || url.username || url.password || url.hash || !path.test(url.pathname) || url.searchParams.get('api-version') !== AZURE_API_VERSION || [...url.searchParams.keys()].length !== 1) throw new OcrProviderError('INVALID_OPERATION');
  return url;
 }
 private async request(url: URL, method: 'GET' | 'POST', body?: string): Promise<Response> {
  try {
   return await this.transport(url.toString(), { method, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { 'Ocp-Apim-Subscription-Key': this.config.key!, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? {body} : {}) });
  } catch { throw new OcrProviderError(method === 'POST' ? 'SUBMISSION_UNKNOWN' : 'PROVIDER_UNAVAILABLE'); }
 }
 async submit(file: DocumentFile, expectedSha256: string): Promise<AzureOperation> {
  const root = endpointOf(this.config);
  try { inspectDocument(file); } catch { throw new OcrProviderError('INVALID_DOCUMENT'); }
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || file.size !== file.buffer.length || createHash('sha256').update(file.buffer).digest('hex') !== expectedSha256) throw new OcrProviderError('INVALID_DOCUMENT');
  const url = new URL('/documentintelligence/documentModels/' + MODEL + ':analyze', root);
  url.searchParams.set('api-version', AZURE_API_VERSION);
  url.searchParams.set('locale', 'pt-BR');
  url.searchParams.set('stringIndexType', 'utf16CodeUnit');
  url.searchParams.set('features', 'keyValuePairs');
  const response = await this.request(url, 'POST', JSON.stringify({ base64Source: file.buffer.toString('base64') }));
  if (response.status === 429) { await response.body?.cancel(); throw new OcrProviderError('RATE_LIMITED', retryAfter(response)); }
  // 5xx and unexpected responses are ambiguous for a POST; never retry blindly.
  if (response.status !== 202) { await response.body?.cancel(); throw new OcrProviderError(response.status >= 500 || response.status < 400 ? 'SUBMISSION_UNKNOWN' : 'PROVIDER_REJECTED'); }
  const location = response.headers.get('operation-location');
  await response.body?.cancel();
  if (!location) throw new OcrProviderError('SUBMISSION_UNKNOWN');
  let operation: URL;
  try { operation = this.operationUrl(location); } catch { throw new OcrProviderError('SUBMISSION_UNKNOWN'); }
  return { url: operation.toString(), retryAfterSeconds: retryAfter(response) };
 }
 async poll(operation: string): Promise<AzurePoll> {
  const response = await this.request(this.operationUrl(operation), 'GET');
  if (!response.ok) {
   await response.body?.cancel();
   throw new OcrProviderError(response.status === 429 ? 'RATE_LIMITED' : response.status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_REJECTED', retryAfter(response));
  }
  const reader = response.body?.getReader();
  if (!reader) throw new OcrProviderError('INVALID_RESPONSE');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
   while (true) {
    const {done,value} = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new OcrProviderError('INVALID_RESPONSE'); }
    chunks.push(value);
   }
  } catch (error) { if (error instanceof OcrProviderError) throw error; throw new OcrProviderError('PROVIDER_UNAVAILABLE'); }
  finally { reader.releaseLock(); }
  let data: any;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new OcrProviderError('INVALID_RESPONSE'); }
  if (data?.status === 'running' || data?.status === 'notStarted') return { status: 'running', retryAfterSeconds: retryAfter(response) };
  if (data?.status === 'failed' || data?.status === 'canceled') return { status: 'failed' };
  const result = data?.analyzeResult;
  if (data?.status !== 'succeeded' || !result || result.apiVersion !== AZURE_API_VERSION || result.modelId !== MODEL || typeof result.content !== 'string' || !Array.isArray(result.documents) || !Array.isArray(result.pages) || !result.pages.length) throw new OcrProviderError('INVALID_RESPONSE');
  return { status: 'succeeded', result };
 }
}
