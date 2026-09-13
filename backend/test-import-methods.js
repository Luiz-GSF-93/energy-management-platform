console.log('🔍 === TESTANDO DIFERENTES IMPORTS ===\n');

// Método 1: Import direto
try {
  const pdf1 = require('pdf-parse');
  console.log('✓ Método 1 - require("pdf-parse"):');
  console.log(`  Type: ${typeof pdf1}`);
  console.log(`  Keys: ${Object.keys(pdf1).slice(0, 5).join(', ')}`);
  console.log(`  Has default: ${typeof pdf1.default}`);
  console.log();
} catch (e) {
  console.log('✗ Método 1 falhou:', e.message, '\n');
}

// Método 2: Arquivo principal
try {
  const pdf2 = require('pdf-parse/dist/pdf-parse.min.js');
  console.log('✓ Método 2 - require("pdf-parse/dist/pdf-parse.min.js"):');
  console.log(`  Type: ${typeof pdf2}`);
  console.log();
} catch (e) {
  console.log('✗ Método 2 falhou:', e.message, '\n');
}

// Método 3: Package.json exports
const pkg = require('pdf-parse/package.json');
console.log('📦 Package.json exports:');
console.log(`  ${JSON.stringify(pkg.exports, null, 2)}`);
