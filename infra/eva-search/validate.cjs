// Offline policy validation. No Azure credentials, subprocesses or provider calls.
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
function validate(t,p){
 assert.equal(t.$schema,'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#');
 assert.equal(t.resources?.length,1);assert.deepEqual(Object.keys(t.parameters),['searchServiceName']);
 const r=t.resources[0];assert.equal(r.type,'Microsoft.Search/searchServices');assert.equal(r.apiVersion,'2025-05-01');assert.equal(r.location,'brazilsouth');assert.equal(r.sku.name,'basic');assert.ok(!r.identity&&!r.resources&&!r.dependsOn);
 assert.equal(r.name,"[parameters('searchServiceName')]");assert.deepEqual(r.properties,{replicaCount:1,partitionCount:1,hostingMode:'Default',publicNetworkAccess:'Disabled',disableLocalAuth:true,networkRuleSet:{bypass:'None',ipRules:[]},semanticSearch:'disabled'});
 assert.deepEqual(Object.keys(t.outputs),['searchServiceId']);assert.equal(t.outputs.searchServiceId.value,"[resourceId('Microsoft.Search/searchServices', parameters('searchServiceName'))]");
 assert.equal(p.$schema,'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#');assert.deepEqual(Object.keys(p.parameters),['searchServiceName']);const name=p.parameters.searchServiceName.value;assert.match(name,/^(?=.{2,60}$)[a-z0-9][a-z0-9]+(-[a-z0-9]+)*$/);
 assert.ok(!JSON.stringify(t).match(/listKeys|roleAssignments|clientSecret|deploymentScripts|Microsoft.Consumption|Microsoft.Network/i));return true;
}
const t=JSON.parse(fs.readFileSync(path.join(__dirname,'search-pilot.template.json'))),p=JSON.parse(fs.readFileSync(path.join(__dirname,'search-pilot.parameters.json')));validate(t,p);let checks=1;
for(const mutate of [x=>x.resources[0].properties.publicNetworkAccess='Enabled',x=>x.resources[0].properties.disableLocalAuth=false,x=>x.resources[0].properties.networkRuleSet.bypass='AzureServices',x=>x.resources[0].properties.replicaCount=2,x=>x.resources[0].properties.semanticSearch='standard',x=>x.resources.push({type:'Microsoft.Authorization/roleAssignments'}),x=>x.resources[0].identity={type:'SystemAssigned'},x=>x.outputs.keys={value:'listKeys(...)'},x=>x.parameters.secret={type:'secureString'}]){const changed=structuredClone(t);mutate(changed);assert.throws(()=>validate(changed,p));checks++;}
assert.throws(()=>validate(t,{...p,parameters:{searchServiceName:{value:'invalid_name'}}}));checks++;console.log(JSON.stringify({result:'PASS',checks,validation:'offline structure and isolation policy; not ARM server validation',providerCalls:0,deployedResources:0}));
