const fs=require('node:fs');const path=require('node:path');
const target=path.join(__dirname,'../public/_pdf');fs.mkdirSync(target,{recursive:true});
fs.copyFileSync(require.resolve('pdfjs-dist/build/pdf.worker.min.mjs'),path.join(target,'pdf.worker.min.mjs'));
