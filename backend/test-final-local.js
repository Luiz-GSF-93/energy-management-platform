const fs = require('fs');
const path = require('path');

async function test() {
  console.log('🧪 TESTE FINAL LOCAL\n');
  
  // Procurar em vários locais
  const locations = [
    './26_08_festball.pdf',
    '../26_08_festball.pdf',
    '/workspaces/26_08_festball.pdf',
    '/workspaces/energy-management-platform/26_08_festball.pdf',
  ];

  let pdfPath = null;
  for (const loc of locations) {
    if (fs.existsSync(loc)) {
      pdfPath = loc;
      console.log(`✅ PDF encontrado: ${loc}\n`);
      break;
    }
  }

  if (!pdfPath) {
    console.error('❌ PDF não encontrado em nenhum local:');
    locations.forEach(loc => console.error(`  - ${loc}`));
    return;
  }

  const buffer = fs.readFileSync(pdfPath);
  console.log(`📦 Buffer: ${buffer.length} bytes\n`);

  try {
    const pdf = require('pdf-parse/lib/pdf-parse.js');
    console.log(`✓ Importação bem-sucedida, tipo: ${typeof pdf}\n`);
    
    const data = await pdf(buffer);
    
    console.log(`✅ SUCESSO!\n`);
    console.log(`📄 Páginas: ${data.numpages}`);
    console.log(`📝 Caracteres: ${data.text?.length || 0}\n`);
    console.log(`📋 PRIMEIROS 500 CHARS:\n${data.text.substring(0, 500)}`);
    
  } catch (error) {
    console.error('❌ Erro:', error.message);
  }
}

test();
