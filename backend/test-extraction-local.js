const fs = require('fs');

async function testExtraction() {
  console.log('🧪 === TESTE LOCAL DE EXTRAÇÃO ===\n');

  // Procurar pelo PDF em diferentes locais
  const possiblePaths = [
    '/workspaces/26_08_festball.pdf',
    '/workspaces/energy-management-platform/26_08_festball.pdf',
    './26_08_festball.pdf',
    '../26_08_festball.pdf',
  ];

  let pdfPath = null;
  for (const path of possiblePaths) {
    if (fs.existsSync(path)) {
      pdfPath = path;
      console.log(`✅ PDF encontrado em: ${path}\n`);
      break;
    }
  }

  if (!pdfPath) {
    console.error('❌ PDF não encontrado em nenhum local esperado');
    console.error('Locais verificados:', possiblePaths);
    return;
  }

  const buffer = fs.readFileSync(pdfPath);
  console.log(`📦 Buffer carregado: ${buffer.length} bytes\n`);

  try {
    console.log('🔄 Tentando pdf-parse...');
    const pdfParseModule = require('pdf-parse');
    const pdfParse = pdfParseModule.default || pdfParseModule;
    
    console.log(`Tipo: ${typeof pdfParse}\n`);

    if (typeof pdfParse !== 'function') {
      throw new Error(`pdfParse não é uma função, é ${typeof pdfParse}`);
    }

    const data = await pdfParse(buffer);
    
    console.log(`✅ PDF processado com sucesso!`);
    console.log(`📄 Páginas: ${data.numpages}`);
    console.log(`📝 Caracteres extraídos: ${data.text?.length || 0}\n`);
    
    if (data.info) {
      console.log(`ℹ️  Producer: ${data.info.Producer || 'N/A'}`);
      console.log(`ℹ️  Title: ${data.info.Title || 'N/A'}\n`);
    }

    if (data.text && data.text.length > 0) {
      console.log(`📋 PRIMEIROS 1000 CARACTERES:\n`);
      console.log(data.text.substring(0, 1000));
      console.log('\n--- (truncado) ---\n');
    } else {
      console.warn('⚠️  NENHUM TEXTO EXTRAÍDO - PDF pode ser image-based\n');
    }

  } catch (error) {
    console.error('❌ Erro:', error.message);
    if (error.stack) {
      console.error('\nStack:', error.stack.substring(0, 500));
    }
  }
}

testExtraction();
