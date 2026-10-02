# bot-energy: assistência controlada no backoffice

O assistente OCR passa a usar o nome bot-energy. O backoffice oferece perguntas controladas sobre regras implementadas; dentro da fatura, consulta pendências, conferências e registros da competência pelas APIs existentes. As respostas indicam fontes e data da consulta. Uma pergunta sem correspondência exata retorna `NO_EVIDENCE`; não é atendimento livre com LLM/RAG.

## Acesso e segurança

- A assistência usa as permissões existentes de documentos/contratos, as licenças de gestão documental/mercado livre e o perfil operacional, gestor ou administrador. A operação da plataforma continua limitada à organização explicitamente selecionada. Não altera permissões, schema ou licença.
- Consultas de registros reutilizam `OcrAssistantService.inspect`, incluindo o vínculo documento/organização/cliente/unidade, versões e fontes atuais. O corpo aceita somente `topic` ou `question`, nunca contexto, comandos ou aprovação enviados pelo cliente.
- Textos de arquivos e respostas são dados, não autorização nem instruções para ferramentas. Não há transmissão para um novo provedor de IA, execução de código, alteração financeira ou gravação de dados por estes endpoints.
- O operador valida preenchimentos. Somente gestor/administrador autorizado aprova financeiramente pelos serviços existentes. Progresso de preparação, confiança OCR, validação humana e publicação permanecem separados.
- Consultas UI são canceladas ao fechar ou mudar o contexto. Respostas de contexto antigo não são apresentadas após troca de organização/perfil.

## Evolução para RAG e demais módulos

A identidade bot-energy pode ser reutilizada, com ferramentas e políticas de cada módulo no backend. Um segundo nome/assistente não cria isolamento de segurança. Antes da busca, aplicar autenticação → organização → RBAC/licença → escopo de dados → recuperação autorizada → resposta com fontes. Um eventual modelo generativo deve usar somente evidências autorizadas, responder sem evidência quando necessário e não ganhar autoridade de aprovação.

O atendimento ao cliente permanece desabilitado. Só implementar após definir os tipos de informação e resultados publicados que poderão ser recuperados, com vínculo do usuário ao cliente e filtros de publicação obrigatórios. A futura IA conversacional deverá respeitar também as permissões específicas de IA; esta entrega é suporte controlado às operações OCR existentes, sem conceder acesso geral de IA ao perfil operacional.

API CCEE continua aguardando habilitação/validação de certificado. Não inicia cobrança ou outros módulos.

## Regressão do progresso de honorários híbridos

Fuga e Del Rei apareciam com 94% porque a memória por unidade retorna `VARIABLE_PENDING` mesmo com a regra mensal confirmada: o variável depende da consolidação do cliente. O indicador tratava essa mensagem como ausência de confirmação mensal.

A etapa só passa quando a prévia consolidada do backend está `AVAILABLE`, sem bloqueios, corresponde ao mesmo cliente, mês, contrato e identificador/versão da regra e inclui a unidade com variável e total calculados. A regra mensal deve estar confirmada, com fonte, fixo e participação da unidade. Ausência, conflito ou consolidação incompleta continuam impedindo 100%. A correção é de apresentação; não muda fórmulas, dados, aprovações ou publicações.
