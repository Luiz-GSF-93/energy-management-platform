const fs = require('fs');
const path = require('path');

async function testRealExtraction() {
  console.log('🧪 === TESTE COM PDF REAL ===\n');

  // Procurar o PDF em vários locais
  const possiblePaths = [
    '../26_08_festball.pdf',
    './26_08_festball.pdf',
    '/workspaces/26_08_festball.pdf',
  ];

  let pdfPath = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      pdfPath = p;
      console.log(`✅ PDF encontrado: ${p}\n`);
      break;
    }
  }

  if (!pdfPath) {
    console.error('❌ PDF não encontrado em nenhum local');
    console.error('Locais procurados:', possiblePaths);
    return;
  }

  const buffer = fs.readFileSync(pdfPath);
  console.log(`📦 Buffer: ${buffer.length} bytes\n`);

  if (buffer.length < 100) {
    console.error('❌ PDF muito pequeno - pode estar corrompido ou vazio');
    return;
  }

  try {
    console.log('🔄 Tentando pdf-parse...');
    const pdfParseModule = require('pdf-parse');
    const pdfParse = pdfParseModule.default || pdfParseModule;
    
    console.log(`📊 Tipo de pdfParse: ${typeof pdfParse}`);
    
    if (typeof pdfParse !== 'function') {
      throw new Error(`pdfParse não é função: ${typeof pdfParse}`);
    }

    const data = await pdfParse(buffer);
    
    console.log(`✅ PDF processado com sucesso!\n`);
    console.log(`📄 Páginas: ${data.numpages}`);
    console.log(`📝 Caracteres extraídos: ${data.text?.length || 0}\n`);
    
    if (data.info) {
      console.log(`Producer: ${data.info.Producer || 'N/A'}`);
      console.log(`Title: ${data.info.Title || 'N/A'}\n`);
    }

    // Procurar por keywords de fatura de energia
    const text = data.text.toLowerCase();
    const keywords = ['cpfl', 'fatura', 'consumo', 'kwh', 'total', 'vencimento'];
    const found = keywords.filter(kw => text.includes(kw));
    
    console.log(`✅ Keywords encontradas: ${found.length}/${keywords.length}`);
    found.forEach(kw => console.log(`  ✓ ${kw}`));
    
    console.log(`\n📋 PRIMEIROS 1000 CARACTERES:\n`);
    console.log(data.text?.substring(0, 1000) || 'SEM TEXTO');
    
  } catch (error) {
    console.error('❌ Erro:', error.message);
  }
}

testRealExtraction();
