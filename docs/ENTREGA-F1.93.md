# F1.93 — Contexto da fatura conectado à preparação

O painel de homologação substitui os estados fixos de parâmetros e custos por consulta às mesmas regras de Preparar apuração. Mostra contagens, rascunhos, versões validadas e pendências atuais. Um cadastro existente nunca é rotulado como importado desta fatura.

Os atalhos para parâmetros, dados mensais, custos e preparação resolvem cliente, unidade e competência no servidor a partir do documento da organização ativa. O frontend também confere o vínculo nos catálogos autorizados antes de selecionar o contexto. Sem alteração de cadastros, validação ou aprovação automática.

## Segurança e limites

- Exige permissões de leitura de documentos e contratos. Reutiliza licença de documentos, origem OCR verificada e licença de gestão do mercado livre.
- A consulta de preparação mantém o isolamento por organização. Divergência entre o documento e o retorno da preparação bloqueia o contexto.
- Link contém somente documento e área permitida. Não aceita identidade ou competência do navegador como origem dos registros.
- Falha apaga resultados anteriores; ausência de dados não vira zero nem homologação.
- Sem migração, nova leitura Azure ou alteração dos dados de Del Rei.
- Integração persistida de tarifas/tributos/custos continua pendente: requer conciliação e mapeamento por componente para não somar TUSD/demanda novamente como custos adicionais nem duplicar TE ACL/tributos. Demanda medida e reativo permanecem com as pendências de F1.92.

## Validação

Backend: 12 testes de acesso, vínculo, erros e projeção de registros; compilação. Frontend: testes DOM de situação real, links, falha, homologação e navegação; compilação Next. Teste de Workspace confirma contexto do documento e rejeição em catálogo de outra organização.
