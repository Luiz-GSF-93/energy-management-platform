const fs = require('fs');

async function test() {
  console.log('🧪 TESTE FINAL LOCAL\n');
  
  const pdfPath = '../26_08_festball.pdf';
  if (!fs.existsSync(pdfPath)) {
    console.error('❌ PDF não encontrado');
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
