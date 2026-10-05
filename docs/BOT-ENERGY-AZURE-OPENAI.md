# Bot-Energy: Azure, rascunhos e conhecimento oficial

Implementação em desenvolvimento. Não confundir o deploy das variáveis no Railway com deploy deste código, aplicação das migrações ou corpus indexado.

## Fluxo

1. OCR Document Intelligence existente, sem alterar configuração.
2. Inspeção autorizada da fatura, fontes, histórico e configurações.
3. Preenchimento automático persistente em `bot_energy_ocr_drafts`, antes de aguardar a inferência: valores comprovados são salvos, inclusive quando há dúvidas. Campos confirmados são preservados; ausência não vira zero. Estado `MACHINE_DRAFT`, autor, fonte, hash e dúvidas. Nunca simular `checkedPdf` ou confirmação humana.
4. Interpretação Azure com resposta estruturada; números copiados das evidências, cálculos feitos pelo motor existente. Uma falha ao gravar observações posteriores não apaga nem invalida o rascunho inicial salvo. O contexto inclui projeções de custos contratuais, diferenças de fatura, honorários e subtotais calculados pelo backend; valores bloqueados são excluídos e subtotais não são economia publicada.
5. Lançamentos já elegíveis nos serviços existentes são executados automaticamente em rascunho, com prévia e token novamente conferidos antes de cada escrita. Falha ou mudança de evidência interrompe o lote e expõe recibos; nunca repetir uma escrita de resultado incerto. Lançamentos dependentes de confirmação/classificação permanecem pendentes com valores extraídos preenchidos. Nenhuma confirmação do PDF, aprovação ou publicação é simulada. O painel recebe os preenchimentos parciais enquanto a IA termina, mantendo as ações bloqueadas até a conclusão da preparação.
6. Assessoria cruza o contexto autorizado com normas recuperadas por data. Sem contexto de mercado confirmado, somente normas `COMMON` são elegíveis. ACL/ACR/GD precisam de contexto explícito, sem presumir mercado.

## RAG

`text-embedding-3-small`, versão 1, 1536 dimensões; deployment `bot-energy-knowledge-embeddings`. Busca exata com pgvector, fontes oficiais, hash, artigo/seção/página, versão e vigência. Migrações f2/f3/f4 aplicadas em 04/10/2026 no Supabase após teste transacional revertido. Extensão vector 0.8.2 no schema extensions. Identificadores de organização, ator e documento usam texto, compatível com o catálogo real; IDs de requisição continuam UUID. As cinco tabelas possuem RLS e as quatro RPCs somente têm EXECUTE para service_role, sem anon/authenticated. Não há corpus indexado nem registros de chamadas pagas neste checkpoint.

Famílias: ANEEL, REN 1000, REN 1059, Lei 14.300, PRODIST, CCEE e ONS. Portais são descoberta; baixar e verificar documentos/módulos completos antes de registrar revisão. A REN 1059 altera outras regras e não substitui a versão consolidada aplicável. Não indexar páginas de navegação como normas.

`BotEnergyKnowledgeIndexService` indexa páginas extraídas em lotes de até oito, preserva origem e retoma trechos já existentes sem pagar novamente por esses trechos. Novas versões entram como `DRAFT`, sem ser usadas em respostas até verificação. Alterações de parser/modelo/hash exigem revisão. Liberação regulatória e aquisição automatizada completa ainda pendentes; não há corpus de produção neste checkpoint.

`BotEnergyRagService` reserva consumo para o embedding da pergunta, consulta RPC e valida fontes de novo. Similaridade é relevância, não confiança jurídica. Conflito ou transição de vigência bloqueia seleção antes da limitação/ranking. Cada resposta deve ser sucinta e permitir abrir a fonte oficial e conferir a vigência.

## Consumo

Migração f3: teto global compartilhado de US$ 50 por mês UTC para conversa e embeddings, com reserva atômica antes da chamada e conciliação pelos tokens retornados. Banco indisponível/preço não verificado bloqueia chamada. Timeout ou resposta inválida mantém reserva até conciliação; não liberar automaticamente consumo que pode ter sido faturado. Teto cobre chamadas deste backend, não uso externo da mesma chave, OCR ou Railway.

Antes de ativar, conferir o mapeamento dos medidores da oferta Azure da assinatura. A API pública Azure Retail Prices foi consultada em 04/10/2026: gpt-6-luna Global Standard em Brazil South tem medidores de entrada curta/longa de USD 0,10/0,20 por milhão e saída curta/longa de USD 0,50/0,75 por milhão. Medidores de cache têm valores distintos. text-embedding-3-small-glbl aparece a USD 0,00002 por mil tokens (USD 0,02 por milhão) nas regiões publicadas; não apareceu um medidor específico Brazil South para embeddings. Esses fatos não ativam a configuração nem substituem a confirmação do medidor aplicável. Fonte: https://prices.azure.com/api/retail/prices e https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices. Nenhum preço da API pública OpenAI foi usado.

Variáveis existentes:
- `AZURE_OPENAI_ENDPOINT=https://expertenergy-ai.openai.azure.com/`
- `AZURE_OPENAI_DEPLOYMENT=bot-energy-backoffice`
- `AZURE_OPENAI_EMBEDDING_DEPLOYMENT=bot-energy-knowledge-embeddings`
- `AZURE_OPENAI_API_KEY`: secret no Railway; nunca no cliente/repositório/log.

Ativação somente após banco, corpus e validação integrada:
- `BOT_ENERGY_AI_ENABLED=true`
- `BOT_ENERGY_RAG_ENABLED=true`
- `BOT_ENERGY_AI_ORGANIZATIONS`: IDs autorizados, separados por vírgula.
- `BOT_ENERGY_AZURE_PRICES_VERIFIED=true`
- `BOT_ENERGY_AZURE_CHAT_INPUT_USD_PER_MILLION`
- `BOT_ENERGY_AZURE_CHAT_OUTPUT_USD_PER_MILLION`
- `BOT_ENERGY_AZURE_EMBEDDING_INPUT_USD_PER_MILLION`

## Pendências antes de produção

Conexão pelo Session pooler IPv4 confirmada com sslmode=verify-full e certificado raiz Supabase válido até 26/04/2031; senha e Enforce SSL preservados. Banco e permissões conferidos após aplicação. Ainda falta concluir o mapeamento dos preços Azure, coletar documentos oficiais, verificar as vigências por versão, indexar e liberar corpus. A coleta dos PDFs ANEEL/PRODIST recebeu HTTP 403 no ambiente local; Planalto teve a conexão interrompida. A coleta anterior no Codespace também não adquiriu documentos. Não substituir os arquivos completos por páginas de navegação. Testar o fluxo integrado e publicar este código; as variáveis já publicadas pelo usuário não equivalem a esse deploy. Controles locais testados não provam ativação na produção.
