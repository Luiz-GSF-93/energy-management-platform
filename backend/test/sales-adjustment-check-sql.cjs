// Reuse the 4I disposable fixture and inject 4J checks in its original scope.
// This runner never connects to a deployed database or provider.
const fs=require('fs');
const prior=fs.readFileSync('test/sales-adjustment-sql.cjs','utf8');
const marker="console.log('4I private adjustment preparation:";
const start=prior.indexOf(marker);
if(start<0)throw new Error('4I fixture marker missing');
const at=prior.indexOf('\n',start)+1;
const source=prior.slice(0,at)+fs.readFileSync('test/sales-adjustment-check-cases.txt','utf8')+prior.slice(at);
new Function('require',source)(require);
