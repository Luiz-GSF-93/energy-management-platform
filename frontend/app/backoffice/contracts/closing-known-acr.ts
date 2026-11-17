/** Display the backend's independent preview. The browser never calculates a financial total. */
export function knownClosingAcr(report:any):string|null{
 const preview=report?.comparisonPreview;
 return preview?.state==='AVAILABLE'&&preview.financialApproval===false&&typeof preview.acr==='string'&&/^\d{1,15}\.\d{2}$/.test(preview.acr)?preview.acr:null;
}
