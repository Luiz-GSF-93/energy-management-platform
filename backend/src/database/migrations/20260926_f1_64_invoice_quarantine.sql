-- Receipt status derived from immutable OCR evidence. Never implies financial approval.
BEGIN;
CREATE OR REPLACE VIEW public.documents_with_intake WITH (security_invoker=true,security_barrier=true) AS
SELECT d.*,
 CASE
  WHEN d.document_type<>'INVOICE_DISTRIBUTOR' THEN 'NOT_APPLICABLE'
  WHEN d.file_verified IS DISTINCT FROM true THEN 'PENDING_RECEIPT'
  WHEN r.file_hash=d.file_hash
   AND r.evidence->'assessment'->>'version'='intake-assessment-v1'
   AND r.evidence->'assessment'->'source'->>'organizationId'=d.organization_id::text
   AND r.evidence->'assessment'->'source'->>'documentId'=d.id::text
   AND r.evidence->'assessment'->'source'->>'customerId'=d.customer_id::text
   AND r.evidence->'assessment'->'source'->>'unitId'=d.consumer_unit_id::text
   AND r.evidence->'assessment'->'source'->>'fileHash'=d.file_hash
   AND r.evidence->'assessment'->'source'->>'referenceMonth'=to_char(d.reference_month,'YYYY-MM')
  THEN CASE r.evidence->'assessment'->'intake'->>'decision'
   WHEN 'REJECT_AUTOMATION' THEN 'REJECTED'
   WHEN 'REVIEW_REQUIRED' THEN 'REVIEW_REQUIRED'
   ELSE 'QUARANTINED' END
  WHEN j.state IN ('QUEUED','SUBMITTING','POLLING') THEN 'IN_REVIEW'
  ELSE 'QUARANTINED'
 END AS intake_state,
 false AS intake_can_import
FROM public.documents d
LEFT JOIN public.document_ocr_jobs j ON j.document_id=d.id AND j.organization_id=d.organization_id
LEFT JOIN public.document_ocr_results r ON r.job_id=j.id AND r.document_id=d.id AND r.organization_id=d.organization_id;
REVOKE ALL ON public.documents_with_intake FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.documents_with_intake TO service_role;
COMMENT ON VIEW public.documents_with_intake IS 'Quarantine/receipt diagnosis only. No approved/importable state in this phase.';
COMMIT;
