const PDFDocument = require('pdfkit');
const fs = require('fs');

// Criar um PDF com o conteúdo da fatura CPFL
const doc = new PDFDocument();
const filename = '26_08_festball.pdf';
doc.pipe(fs.createWriteStream(filename));

// Cabeçalho
doc.fontSize(10).text('COMPANHIA PAULISTA DE FORÇA E LUZ');
doc.text('CNPJ: 33.050.196/0001-88');
doc.text('DANF3E - DOCUMENTO AUXILIAR DA NOTA FISCAL DE ENERGIA ELÉTRICA ELETRÔNICA\n');

// Cliente
doc.fontSize(11).text('CLIENTE', { underline: true });
doc.fontSize(10);
doc.text('DEL REI INDUSTRIA ARTEFATOS DE LATEX LTDA');
doc.text('R ITANHAEM, 2957 - VL ELISA');
doc.text('RIBEIRAO PRETO - SP - 14075-050');
doc.text('CNPJ: 64.734.221/0001-76');
doc.text('Inscrição Estadual: 582290401119\n');

// Dados da fatura
doc.fontSize(11).text('FATURA DE ENERGIA ELÉTRICA', { underline: true });
doc.fontSize(10);
doc.text('Número da NF: 058824507');
doc.text('Data de Emissão: 04/09/2026');
doc.text('Período de Referência: Agosto/2026 (AGO/26)');
doc.text('Data de Vencimento: 15/09/2026');
doc.text('UC (Unidade Consumidora): 1.574.348.035-70\n');

// Classificação
doc.text('Classificação: Tarifa Verde Livre-A4 Industrial');
doc.text('Tipo de Fornecimento: Trifásico\n');

// Consumo
doc.fontSize(11).text('CONSUMO', { underline: true });
doc.fontSize(10);
doc.text('Energia Ativa Ponta: 11.378,64 kWh');
doc.text('Energia Ativa Fora Ponta: 99.743,56 kWh');
doc.text('Total Consumo: 111.122,20 kWh\n');

// Demanda
doc.text('Demanda Ativa Ponta: 203 kW');
doc.text('Demanda Ativa Fora Ponta: 235 kW\n');

// Valores
doc.fontSize(11).text('DISCRIMINAÇÃO DE VALORES', { underline: true });
doc.fontSize(10);
doc.text('Energia ACL - Ponta: R$ 5.128,70');
doc.text('Energia ACL - Fora Ponta: R$ 29.092,21');
doc.text('TUSD Consumo: R$ 21.211,15');
doc.text('CDE Escassez Hídrica: R$ 558,53');
doc.text('Subvenção Tarifária: (R$ 12.214,83)\n');

// Tributos
doc.text('ICMS: R$ 46.762,49');
doc.text('PIS/PASEP: R$ 43.004,68');
doc.text('COFINS: R$ 43.004,68');
doc.text('Contribuição CIP: R$ 137,58\n');

// Total
doc.fontSize(14).text('TOTAL A PAGAR: R$ 40.583,96', { underline: true });
doc.fontSize(10);
doc.text('\nDescontos Informativos: (R$ 34.173,16)');
doc.text('Devolução TUSD Mês MAI/26: (R$ 89,83)\n');

doc.fontSize(9).text('Atraso no pagamento será cobrado em conta futura: Multa 2%, Juros 0,033% ao dia e Correção Monetária, conforme Legislação vigente.');
doc.text('Consulte pela chave de Acesso em: https://dfe-portal.svrs.rs.gov.br/NF3E/Consulta');
doc.text('Chave de Acesso: 35260933050196000188660000588245071033590952');
doc.text('Protocolo de autorização: 3352600181704439 - 05.09.2026 às 02:30:13');

doc.end();

console.log(`✅ PDF criado: ${filename}`);
