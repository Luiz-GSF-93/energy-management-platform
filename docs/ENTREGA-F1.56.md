# F1.56 — Bases tributárias com valores operacionais automáticos

## Comportamento

O cadastro de Parâmetros de cálculo → Custos e créditos possui Origem do valor. Além do valor manual, oferece energia contratual consumida, mínimo não consumido, compra extra e custos mensais de CCEE, exposição, encargos e outros custos. O valor automático não é digitado: ele referencia a memória do fornecedor ou lançamentos validados da competência. Não é um novo custo e não deve ser somado novamente.

O operador registra unidade, cenário, vigência, tratamento, fonte e regra. O parâmetro segue rascunho → revisão/aprovação. Em seguida, tributos aprovados podem incluir/excluir a rubrica na base estruturada existente. O cálculo reutiliza as regras explícitas de por dentro, por fora, independente, sequencial e por dentro conjunto; já incluído conserva a declaração, sem novo imposto. Nenhuma incidência é presumida.

Fornecedor: energia = faturamento regular menos mínimo não consumido. Mínimo e compra extra têm origens separadas. NF não é uma quarta origem nem um segundo custo. O fornecedor deve estar sem pendências, com ciclo encerrado e fontes rastreáveis. Compra extra conserva referências dos lançamentos; créditos bloqueiam a base até existir tratamento tributário específico.

Custos mensais: somente a categoria e o cenário configurados, com versão validada e tratamento compatível. Ausência de itens não equivale a zero; somente declaração explícita validada de ausência de custos permite zero. Categorias com créditos ou mistura de tratamentos ficam pendentes.

## Conferência

Em Preparar apuração → Memórias de cálculo, fórmulas e fontes, o painel Bases automáticas do fornecedor e custos mostra valores, fontes e revisões, além de links para corrigir/configurar. As pendências também entram na lista de revisão. A memória tributária usa essas bases aprovadas com precisão decimal no servidor.

Se um tributo tiver base que combine distribuidora, fornecedor e custos, seu valor fica na memória tributária geral. Ele não é atribuído integralmente ao subtotal exclusivo da distribuidora; esse subtotal mantém bloqueio explícito até a consolidação geral, evitando dupla contagem.

## Dados e segurança

Migração: 20260926_f1_56_operational_tax_bases.sql. Coluna opcional monetary_source; cadastros anteriores seguem manuais. Guard preserva escopo, atores, aprovação e histórico e impede valor manual em origem automática. Apenas uma configuração aprovada por origem/cenário/unidade com vigência sobreposta, usando lock transacional. Não houve mudança de permissões.

Migração testada duas vezes em banco isolado; versão de produção anterior conferida antes de substituir o guard, com equivalência após normalização de espaços. Em produção: coluna e guard presentes, RLS ativo e leitura direta anon/authenticated bloqueada. Nenhum cadastro de negócio foi criado para teste.

## Validação

- Backend/frontend compilados.
- 300 testes de backend aprovados na execução final.
- 151 verificações de banco, serviço, transição, escopo, fonte e histórico aprovadas.
- Interface: 19 verificações de origem automática, 19 de memória tributária e 18 de lançamento guiado aprovadas.
- ESLint nos componentes principais alterados aprovado.

## Próximos passos

Continua a Etapa 4 do Prompt Mestre. Falta consolidar os custos e os tributos calculados uma única vez nos cenários ACL/ACR, calcular a economia consolidada do cliente e a parcela variável dos honorários e preservar snapshots para validação/publicação. Permanecem fora desta entrega segmentação intramensal e tratamento tributário de créditos. OCR e integração CCEE permanecem etapas seguintes.
