const fs = require('fs');

async function test() {
  console.log('🧪 TESTE COM PDFJS-DIST\n');
  
  const pdfPath = './26_08_festball.pdf';
  if (!fs.existsSync(pdfPath)) {
    console.error('❌ PDF não encontrado:', pdfPath);
    console.error('Arquivos no diretório:');
    console.error(fs.readdirSync('.').filter(f => f.endsWith('.pdf')));
    return;
  }

  const buffer = fs.readFileSync(pdfPath);
  console.log(`📦 Buffer: ${buffer.length} bytes\n`);

  try {
    const pdfjs = require('pdfjs-dist');
    console.log('✓ pdfjs-dist carregado\n');
    
    const uint8Array = new Uint8Array(buffer);
    const pdf = await pdfjs.getDocument({ data: uint8Array }).promise;
    
    console.log(`✅ PDF carregado: ${pdf.numPages} páginas\n`);

    let fullText = '';
    
    for (let pageNum = 1; pageNum <= Math.min(pdf.numPages, 3); pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str || '').join(' ');
      fullText += pageText + '\n';
      console.log(`✓ Página ${pageNum}: ${pageText.length} caracteres`);
    }

    console.log(`\n✅ TOTAL: ${fullText.length} caracteres\n`);
    console.log(`📋 PRIMEIROS 800 CARACTERES:\n${fullText.substring(0, 800)}`);
    
  } catch (error) {
    console.error('❌ Erro:', error.message);
    console.error(error.stack?.substring(0, 300));
  }
}

test();
