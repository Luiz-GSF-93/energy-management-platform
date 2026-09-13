const fs = require('fs');
const path = require('path');

(async () => {
  console.log('🧪 Teste de Extração PDF Local\n');
  
  const pdfPath = './26_08_festball.pdf';
  if (!fs.existsSync(pdfPath)) {
    console.error('❌ PDF não encontrado:', pdfPath);
    return;
  }

  const buffer = fs.readFileSync(pdfPath);
  console.log(`📦 Buffer: ${buffer.length} bytes\n`);

  try {
    console.log('⏳ Importando pdfjs-dist...');
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js');
    const pdfjsLib = pdfjs.default;
    console.log(`✅ pdfjs-dist v${pdfjsLib.version} importado\n`);

    console.log('⏳ Configurando worker local...');
    // ✅ Usar o worker local (não a URL do CDN)
    const workerPath = path.join(path.dirname(require.resolve('pdfjs-dist/legacy/build/pdf.js')), 'pdf.worker.min.js');
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerPath;
    console.log(`✅ Worker configurado: ${workerPath}\n`);

    // ✅ Converter Buffer para Uint8Array
    const uint8Array = new Uint8Array(buffer);
    console.log('✅ Buffer convertido para Uint8Array\n');

    console.log('⏳ Fazendo parse do PDF...');
    const pdf = await pdfjsLib.getDocument({ data: uint8Array }).promise;
    console.log(`✅ PDF carregado: ${pdf.numPages} páginas\n`);

    let fullText = '';
    for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
      console.log(`⏳ Extraindo página ${i}...`);
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join('');
      fullText += pageText + '\n';
      console.log(`✅ Página ${i}: ${pageText.length} caracteres\n`);
    }

    console.log(`✅ Total extraído: ${fullText.length} caracteres`);
    console.log('\n📄 Primeiros 500 caracteres:\n');
    console.log(fullText.substring(0, 500));
  } catch (error) {
    console.error('❌ Erro:', error.message);
    console.error(error);
  }
})();
