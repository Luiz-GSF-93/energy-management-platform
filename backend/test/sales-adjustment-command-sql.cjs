// Extend the disposable 4J fixture; never connects to production or Asaas.
const fs=require('fs');
const prior=fs.readFileSync('test/sales-adjustment-check-sql.cjs','utf8');
const marker="fs.readFileSync('test/sales-adjustment-check-cases.txt','utf8')";
if(!prior.includes(marker))throw new Error('4J fixture marker missing');
const source=prior.replace(marker,"(fs.readFileSync('test/sales-adjustment-check-cases.txt','utf8')+fs.readFileSync('test/sales-adjustment-command-cases.txt','utf8'))");
new Function('require',source)(require);
