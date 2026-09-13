const fs = require('fs');
const path = require('path');

// Simular a extração
async function testExtraction() {
  console.log('🧪 === TESTE DE EXTRAÇÃO DE PDF ===\n');

  const pdfPath = '../26_08_festball.pdf'; // Ajuste o caminho se necessário
  
  if (!fs.existsSync(pdfPath)) {
    console.error('❌ Arquivo PDF não encontrado:', pdfPath);
    return;
  }

  const buffer = fs.readFileSync(pdfPath);
  console.log(`📦 Buffer carregado: ${buffer.length} bytes\n`);

  try {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    
    console.log(`✅ PDF processado com sucesso!`);
    console.log(`📄 Páginas: ${data.numpages}`);
    console.log(`📝 Caracteres: ${data.text?.length || 0}`);
    console.log(`\n📋 PRIMEIROS 500 CARACTERES:\n`);
    console.log(data.text?.substring(0, 500) || 'NENHUM TEXTO');
    
  } catch (error) {
    console.error('❌ Erro na extração:', error.message);
  }
}

testExtraction();
