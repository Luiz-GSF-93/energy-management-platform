const pdfParseModule = require('pdf-parse');

console.log('📊 === DEBUG PDF-PARSE ===\n');
console.log('Type:', typeof pdfParseModule);
console.log('Is Function:', typeof pdfParseModule === 'function');
console.log('Keys:', Object.keys(pdfParseModule));
console.log('Default:', typeof pdfParseModule.default);
console.log('Has PDFParse:', typeof pdfParseModule.PDFParse);

console.log('\n🔍 Full object:');
console.log(pdfParseModule);
