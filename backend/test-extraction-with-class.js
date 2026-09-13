const fs = require('fs');

async function test() {
  console.log('🧪 TESTE LOCAL COM PDFPARSE CLASS\n');
  
  const pdfPath = '../26_08_festball.pdf';
  if (!fs.existsSync(pdfPath)) {
    console.error('❌ PDF não encontrado:', pdfPath);
    return;
  }

  const buffer = fs.readFileSync(pdfPath);
  console.log(`📦 Buffer: ${buffer.length} bytes\n`);

  try {
    console.log('🔄 Carregando pdf-parse...');
    const pdfParseModule = require('pdf-parse');
    
    if (typeof pdfParseModule.PDFParse !== 'function') {
      throw new Error('PDFParse não é uma função');
    }

    console.log('✓ PDFParse class encontrada\n');
    console.log('🔄 Processando PDF...');
    
    const pdfParser = new pdfParseModule.PDFParse();
    await pdfParser.parseBuffer(buffer);
    
    console.log(`✅ Sucesso!\n`);
    console.log(`📄 Páginas: ${pdfParser.numpages}`);
    console.log(`📝 Caracteres: ${pdfParser.text?.length || 0}\n`);
    
    // Verificar keywords
    const text = pdfParser.text.toLowerCase();
    const keywords = ['cpfl', 'fatura', 'consumo', 'kwh', 'total', 'vencimento'];
    const found = keywords.filter(kw => text.includes(kw));
    
    console.log(`✅ Keywords encontradas: ${found.length}/${keywords.length}`);
    found.forEach(kw => console.log(`  ✓ "${kw}"`));
    
    console.log(`\n📋 PRIMEIROS 800 CARACTERES:\n`);
    console.log(pdfParser.text.substring(0, 800));
    
  } catch (error) {
    console.error('❌ Erro:', error.message);
    if (error.stack) console.error('\nStack:', error.stack.substring(0, 500));
  }
}

test();
