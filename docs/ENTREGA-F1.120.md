# F1.120 — Compra pontual documentada do fornecedor

Permite confirmar SPOT para uma única competência completa, com preço final e sem mínimo/tolerância take-or-pay. A regra permanece imutável e versionada, com autor, motivo e fonte; RBAC, licença, isolamento e controle de concorrência existentes são preservados.

O motor reutiliza volume e preço por vigência do cadastro e exige uma única nota validada em Custos mensais (Fatura do fornecedor). Compara quantidade × preço com o valor documental em centavos, sem somar a NF novamente. Não aceita compras extras ou créditos concorrentes nesta modalidade. A memória operacional preserva versão dos custos e identificação do lançamento.

Consumo OCR não é alterado. Diferenças entre quantidade comprada e consumo permanecem explícitas e impedem consolidação. Não presume ajuste, perdas, compra adicional, mínimo ou tratamento tributário. Múltiplas compras e resolução auditada de diferenças volumétricas continuam pendentes de extensão específica.

## Validação

- Backend: build e 175 testes de fornecedor, bases operacionais, composição e preparação.
- Banco isolado: 38 verificações de serviço/migração, versões, acesso, nulidade dos limites e vigência pontual.
- Frontend: build e 17 verificações DOM, incluindo ausência de limites no payload SPOT e diferença volumétrica visível.

## Publicação

Aplicar 20260928_f1_120_spot_supplier.sql antes de publicar o formulário. Migração idempotente; preserva registros anteriores e permissões existentes. Nenhum cadastro financeiro de produção é convertido automaticamente.
