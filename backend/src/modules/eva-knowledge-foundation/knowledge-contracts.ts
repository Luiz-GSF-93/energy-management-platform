/** Phase 0 contracts only: no registered controller, provider or database writer. */
export const FOUNDATION_RELEASE='eva-knowledge-phase0-v1';
export const FOUNDATION_RUNTIME=Object.freeze({enabled:false,externalCalls:false,ingestion:false,productionMigration:false});
export type KnowledgeAudience='BACKOFFICE'|'PORTAL'|'PLATFORM';
export type KnowledgeScope='OFFICIAL_PUBLIC'|'PRODUCT'|'PLATFORM_INTERNAL'|'ORGANIZATION'|'CLIENT_UNIT';
export type KnowledgeState='DRAFT'|'REVIEWED'|'PUBLISHED'|'QUARANTINED'|'RETIRED';
export type SourceKind='OFFICIAL'|'PRODUCT_GUIDE'|'SPECIALIST'|'OPERATIONAL';
export type RankingKind='COSINE'|'RRF'|'SEMANTIC_RERANK'|'DETERMINISTIC';
export type KnowledgeCapability='SOURCE_PREPARE'|'SOURCE_REVIEW'|'SOURCE_PUBLISH'|'INDEX_CONFIGURE'|'COST_READ';

/** Must be resolved by the authenticated backend; never accept this context from a body. */
export type KnowledgeReadContext={
 verified:boolean;actorId:string;audience:KnowledgeAudience;organizationId:string|null;
 platformProfile?:'OWNER'|'ADMINISTRATOR'|'FINANCE'|'SUPPORT';
 permissions:readonly string[];licensedModules:readonly string[];licenseCurrent:boolean;
 unitBinding?:{verified:boolean;customerId:string;unitIds:readonly string[]};
};
export type KnowledgeRequest={unitId?:string;periodStart:string;periodEnd:string;productRelease:string};
export type KnowledgeRevision={
 id:string;sourceKind:SourceKind;scope:KnowledgeScope;organizationId:string|null;
 customerId:string|null;unitId:string|null;audiences:readonly KnowledgeAudience[];
 allowedPlatformProfiles:readonly ('OWNER'|'ADMINISTRATOR'|'FINANCE'|'SUPPORT')[];
 state:KnowledgeState;version:string;hash:string;reviewedBy:string|null;reviewedAt:string|null;
 publishedAt:string|null;validFrom:string;validTo:string|null;productRelease:string|null;
 requiredPermissions:readonly string[];requiredModules:readonly string[];
 sourceId:string;section:string;page:number|null;contentHash:string;
};
export type EligibilityReason='ELIGIBLE'|'INVALID_CONTEXT'|'LICENSE_REQUIRED'|'AUDIENCE_DENIED'|
 'NOT_PUBLISHED'|'INVALID_PROVENANCE'|'INVALID_PERIOD'|'VALIDITY_CONFLICT'|'PRODUCT_VERSION_MISMATCH'|
 'PERMISSION_DENIED'|'MODULE_DENIED'|'TENANT_DENIED'|'UNIT_DENIED'|'PLATFORM_PROFILE_DENIED';
export type Eligibility={eligible:boolean;reason:EligibilityReason};
export type RetrievalPlan={
 release:typeof FOUNDATION_RELEASE;state:'DISABLED';selectedRevisionIds:readonly string[];
 externalRequests:0;databaseWrites:0;
};
/** Provider scores retain their native kind; they never express legal confidence. */
export type ProviderHit={revisionId:string;contentHash:string;ranking:RankingKind;score:number|null};
export interface KnowledgeRetriever {
 readonly kind:'PGVECTOR'|'AZURE_SEARCH'|'DETERMINISTIC_GUIDE';
 retrieve(request:{periodStart:string;periodEnd:string;authorizedRevisionIds:readonly string[];
  queryVector?:readonly number[];question:string;limit:number;signal:AbortSignal}):Promise<readonly ProviderHit[]>;
}
export interface KnowledgeOriginalStore {
 readVerifiedOriginal(reference:{revisionId:string;hash:string;privateStorageRef:string},signal:AbortSignal):Promise<Uint8Array>;
}
export interface KnowledgeIngestionPort {
 prepare(request:{revisionId:string;expectedDocumentHash:string;parserVersion:string;embeddingVersion:string;
  costScope:'PLATFORM_CORPUS'|'ORGANIZATION';organizationId:string|null;idempotencyKey:string}):Promise<{jobId:string;state:'DRAFT'}>;
}
/** Hard disabled until a separately approved implementation. No network port is invoked. */
export function foundationRetrievalPlan():RetrievalPlan{
 return {release:FOUNDATION_RELEASE,state:'DISABLED',selectedRevisionIds:[],externalRequests:0,databaseWrites:0};
}
