// Disposable cumulative fixture only; never connects to production or Asaas.
const fs=require('fs');
const prior=fs.readFileSync('test/sales-adjustment-command-sql.cjs','utf8');
const marker=fs.readFileSync('test/sales-adjustment-command-cases.txt','utf8');
const cases=marker+'\n'+fs.readFileSync('test/sales-evidence-diagnostics-cases.txt','utf8');
const fixtureFs={...fs,readFileSync:(name,...args)=>name==='test/sales-adjustment-command-cases.txt'?cases:fs.readFileSync(name,...args)};
new Function('require',prior)(name=>name==='fs'?fixtureFs:require(name));
