const fs = require('fs');
const path = require('path');

async function testRealExtraction() {
  console.log('🧪 === TESTE COM PDF REAL ===\n');

  const pdfPath = './26_08_festball.pdf';
  
  if (!fs.existsSync(pdfPath)) {
    console.error('❌ PDF não encontrado em:', pdfPath);
    return;
  }

  const buffer = fs.readFileSync(pdfPath);
  console.log(`📦 Buffer: ${buffer.length} bytes\n`);

  try {
    console.log('🔄 Tentando pdf-parse...');
    const pdfParseModule = require('pdf-parse');
    const pdfParse = pdfParseModule.default || pdfParseModule;
    
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
    const keywords = ['cpfl', 'fatura', 'consumo', 'kwh', 'total a pagar', 'vencimento'];
    const found = keywords.filter(kw => text.includes(kw));
    
    console.log(`✅ Keywords encontradas: ${found.length}/${keywords.length}`);
    found.forEach(kw => console.log(`  ✓ ${kw}`));
    
    console.log(`\n📋 PRIMEIROS 800 CARACTERES:\n`);
    console.log(data.text?.substring(0, 800));
    
  } catch (error) {
    console.error('❌ Erro:', error.message);
    if (error.stack) console.error(error.stack.substring(0, 300));
  }
}

testRealExtraction();
