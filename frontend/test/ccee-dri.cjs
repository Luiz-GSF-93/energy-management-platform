const fs=require('node:fs'),assert=require('node:assert/strict');
const source=fs.readFileSync('app/backoffice/ccee-data/DriWorkspace.tsx','utf8'),workspace=fs.readFileSync('app/backoffice/ccee-data/Workspace.tsx','utf8');
for(const token of ['organizationId!==organizationId','generation.current','DRI_EVENTS','DRI_REPORTS','DRI_RESULTS','parentJobId','CODIGO_AGENTE','Classificação financeira pendente','slice(0,50)','Não informado na fonte'])assert(source.includes(token),token);
assert(!/dangerouslySetInnerHTML|\.innerHTML|eval\(/.test(source));assert(workspace.includes('CCEE_DRI_READ_ENABLED'));assert(workspace.includes('driAgentCode'));assert(workspace.includes('driTaxId'));
console.log('PASS private DRI UI: scoped state, dependent catalogs, evidence, limits and escaped values');
