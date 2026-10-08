import {pldHours} from './ccee-response';
// Only an explicit adapter may interpret a provider response. UI never parses SOAP.
export const normalizeCceePld=pldHours;
export type CceeKind='CONSUMPTION'|'CHARGE'|'FEE'|'CREDIT'|'SHORT_TERM_MARKET'|'AGENDA'|'OTHER';
export type CceeEvidence={provider:'CCEE';service:string;externalId:string;revision:string;month:string;retrievedAt:string;sourceHash:string;finality:'PROVISIONAL'|'FINAL'};
export type CceeBinding={organizationId:string;customerId:string;unitId:string;profileCode:string;measurementPoint:string;authorizationId:string;authorizationRevision:number};
export type CceeNormalizedRecord={schemaVersion:'ccee-record/1';kind:CceeKind;binding:CceeBinding;evidence:CceeEvidence;lines:CceeLine[]};
export type CceeLine=
 | {type:'CONSUMPTION';code:string;quantityKwh:string;timeBand:'PEAK'|'OFF_PEAK'|'ALL';includesLosses:boolean|null}
 | {type:'MONEY';code:string;amountBrl:string;effect:'DEBIT'|'CREDIT';taxTreatment:'NET'|'GROSS'|'UNKNOWN';category:'CCEE'|'CHARGE'|'EXPOSURE'|'OTHER'}
 | {type:'AGENDA';code:string;startsAt:string;endsAt:string;timezone:'America/Sao_Paulo';title:string};
// These are normalized contracts, not a claim that the corresponding SOAP services are enabled.
export const CCEE_SERVICE_COVERAGE:Record<CceeKind,'BINDING_AND_SERVICE_REQUIRED'>={CONSUMPTION:'BINDING_AND_SERVICE_REQUIRED',CHARGE:'BINDING_AND_SERVICE_REQUIRED',FEE:'BINDING_AND_SERVICE_REQUIRED',CREDIT:'BINDING_AND_SERVICE_REQUIRED',SHORT_TERM_MARKET:'BINDING_AND_SERVICE_REQUIRED',AGENDA:'BINDING_AND_SERVICE_REQUIRED',OTHER:'BINDING_AND_SERVICE_REQUIRED'};
