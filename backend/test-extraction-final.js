const fs = require('fs');

async function test() {
  console.log('🧪 TESTE DE EXTRAÇÃO FINAL\n');
  
  const pdfPath = '../26_08_festball.pdf';
  if (!fs.existsSync(pdfPath)) {
    console.error('❌ PDF não encontrado:', pdfPath);
    return;
  }

  const buffer = fs.readFileSync(pdfPath);
  console.log(`📦 Buffer: ${buffer.length} bytes\n`);

  try {
    const pdfParseModule = require('pdf-parse');
    const pdfParse = pdfParseModule.default || pdfParseModule;
    
    const data = await pdfParse(buffer);
    console.log(`✅ Sucesso!`);
    console.log(`📄 Páginas: ${data.numpages}`);
    console.log(`📝 Caracteres: ${data.text?.length || 0}\n`);
    
    // Verificar keywords
    const text = data.text.toLowerCase();
    const keywords = ['cpfl', 'fatura', 'consumo', 'kwh', 'total a pagar', '40.583,96'];
    const found = keywords.filter(kw => text.includes(kw));
    
    console.log(`✅ Keywords: ${found.length}/${keywords.length}`);
    found.forEach(kw => console.log(`  ✓ "${kw}"`));
    
    console.log(`\n📋 TEXTO EXTRAÍDO (primeiros 800 chars):\n`);
    console.log(data.text.substring(0, 800));
  } catch (error) {
    console.error('❌ Erro:', error.message);
  }
}

test();
