# EVA — conversa contextual e regressão offline

Escopo autorizado em 15/10/2026: executar a regressão offline proposta e melhorar a conversa, limpando a entrada após envio, aproveitando o contexto e pedindo esclarecimentos quando necessário.

Impactos definidos antes da implementação:

- Arquitetura: manter os serviços de RAG, autorização, geração e orçamento existentes. Resolver continuações curtas com a pergunta anterior do usuário, limitada e tratada como texto não confiável; jamais usar resposta anterior como evidência.
- API: extensão aditiva `previousQuestion?: string` em perguntas do backoffice (máximo 500 caracteres). Chamadas antigas `{question}` e `{topic}` continuam válidas. O endpoint de tópicos anuncia `conversationContext: true`; o frontend só envia o novo campo quando a API anuncia suporte, preservando implantação em ordens diferentes. `conversationQuestion` na resposta permite manter a referência resolvida apenas na memória da interface.
- Dados/migração: nenhuma tabela, RPC, migração ou persistência de conversa nova. O catálogo, índice, publicações e ledger atuais ficam intactos.
- Permissões: nenhuma concessão. Reautorizar tenant, documento, licença e fonte em cada pergunta. Histórico não concede acesso nem fornece números comprovados.
- Interface: limpar a pergunta no envio; restaurar em erro de transporte. Limpar contexto ao mudar documento/cliente/unidade ou encerrar conversa; o próprio componente remonta por identidade, organização, papel, permissões e documento. É possível redigir a próxima mensagem enquanto a resposta chega; uma falha não sobrescreve esse rascunho. Relatórios também limpam o campo, preservando seu contrato próprio.
- Linguagem: instruir respostas naturais, curtas e acolhedoras; perguntar o dado que falta sem exigir termos técnicos exatos. Ambiguidade sem assunto identificável recebe esclarecimento local, sem chamada paga. Controles numéricos, fonte, vigência e revisão permanecem.
- Testes: composição real do chat, fachada, recuperação, conector e orçamento com persistência/transportes sintéticos e rede real bloqueada; testes DOM dos componentes. Regressões existentes, builds Nest/Next.
- Custos: sem chamada paga ou nova infraestrutura. CI/desenvolvimento usam ferramentas existentes; nenhum consumo sintético entra no painel.
- Riscos: resolução textual conservadora não equivale a compreensão irrestrita; perguntas ambíguas pedem esclarecimento. A resposta histórica rejeitada não está disponível para reprodução exata. Teste offline não mede latência/qualidade do modelo vivo.
- Reversão: reverter arquivos de código/testes deste incremento; nenhum rollback SQL ou de flags.

Critérios de aceite: entrada vazia após envio e recuperável em falha; continuação curta usa assunto anterior e fontes atuais; mudança de assunto/contexto não reutiliza respostas/fontes antigas; pergunta vaga pede esclarecimento; números inventados, fontes ausentes/revogadas e acesso sem licença/permissão permanecem bloqueados; uso comprovado liquida uma vez e resultado incerto mantém reserva. Nenhuma reindexação, envio, cobrança, assinatura ou alteração de acesso/deploy nesta entrega.

## Entrega implementada e validação local

Complemento após teste do usuário: captura com a pergunta “quais documentos para ser agente na ccee” ainda mostra a mensagem anterior; main remoto permanece `99a7846`, sem esta implementação. A consulta pública ao site foi bloqueada pelo proxy do ambiente com HTTP403, portanto não foi possível atestar o SHA do frontend vivo. Ajuste adicional definido antes do código: pedir perfil em perguntas de ingresso/documentação CCEE sem enquadramento, aceitar a resposta curta preservando a pergunta original e distinguir recuperação READY de abstenção do modelo. Sem nova tabela/API/flag/migração/reindexação; manter os contratos aditivos já descritos. Testes devem cobrir a pergunta literal da captura e a retomada após “consumidor”.

- Campo principal limpo no envio, com a última pergunta visível e foco para continuar. É possível redigir enquanto aguarda; novo envio fica bloqueado até terminar. Erro de transporte recupera o texto se o campo continuar vazio e preserva um próximo rascunho já digitado. O campo dos relatórios também é limpo após envio e recuperado em falha.
- Continuação como “E o prazo?” aproveita a pergunta anterior, sem reutilizar resposta ou fontes antigas. Perguntas sem assunto identificável pedem esclarecimento sem consumir IA. Nova pergunta com assunto próprio substitui o contexto anterior. A composição fica limitada a 500 caracteres; acima disso pede esclarecimento.
- Estado da conversa descartado ao fechar ou trocar identidade, organização, papel, permissões ou documento. Mudanças explícitas de cliente/unidade/fatura também descartam o estado.
- Linguagem do prompt de backoffice mais natural e objetiva, versão `backoffice-evidence-v4-eva`. Abstenção continua controlada pelo serviço: o texto livre de uma resposta não sustentada do modelo não é publicado como esclarecimento confiável.
- API de tópicos anuncia a capacidade; backend aceita o campo opcional estritamente validado. Cliente antigo mantém funcionamento; frontend novo com backend antigo mantém o payload original.
- Integração offline usa os serviços reais de chat, fachada, recuperação, geração e orçamento, com RPC/ledger e transportes sintéticos. O `fetch` global é bloqueado e a suíte exige que não seja usado. O fixture normativo reconstruído não comprova novamente o PDF oficial real.
- CI existente atualizado para incluir as suítes e os componentes deste incremento. Execução no GitHub ainda não realizada, pois não houve push/PR.

Resultados executados nesta máquina:

- 220 testes Jest aprovados em 11 suítes dirigidas: corpus, conversa, integração da cadeia, conector Azure, serviço de IA, orçamento, chat, seleção de pergunta, RAG legado, guias e relatórios.
- Após a inclusão do anúncio de capacidade, as três suítes afetadas de conversa/integração/chat foram reexecutadas: 58 testes aprovados.
- `frontend/test/bot-energy.cjs`, `eva-corpus-citations.cjs` e `eva-product-guides.cjs`: aprovados com componentes React reais em DOM isolado. Incluem limpeza/recuperação, composição da próxima mensagem, bloqueio de envio simultâneo, compatibilidade com API anterior, cancelamento, isolamento, fontes e guias.
- Builds Nest e Next aprovados. Next concluiu compilação, TypeScript e geração das páginas. `git diff --check` aprovado.
- Não foram executados lint global, toda a suíte do produto, migrações, teste vivo de IA ou homologação em produção.

Problemas de preparação encontrados e corrigidos: o cache padrão do npm estava indisponível para escrita; a instalação pelo lockfile passou usando `--cache /tmp/energyos-npm-cache`, sem desabilitar verificações de integridade/TLS. Os testes DOM e TypeScript também apontaram problemas na ordem de declaração dos hooks e no estreitamento do contexto de autenticação durante a implementação; ambos corrigidos e revalidados.

## Como conferir manualmente após publicação autorizada

1. Abrir EVA no backoffice autorizado da Expert Energy, enviar uma pergunta e conferir entrada vazia. Digitar a próxima enquanto aguarda; apenas um envio deve estar em andamento.
2. Perguntar “Como funciona a validação do agente conectado na CCEE?” e depois “E o prazo?”. Conferir se a continuação usa o assunto e fontes revisadas atuais. A resposta viva depende do modelo e exige uma homologação delimitada; não foi executada nesta entrega.
3. Abrir uma conversa nova e perguntar “Qual o prazo?”. A EVA deve perguntar de qual etapa/processo se trata. Informar o assunto com palavras comuns e continuar.
4. Trocar a fatura ou organização e conferir que a conversa anterior não aparece. Uma nova pergunta não deve herdar o contexto anterior.
5. Em ambiente de teste, simular falha de transporte: o texto enviado deve voltar se o campo estiver vazio; um próximo rascunho já digitado deve ser preservado.
6. Confirmar que GD sem norma continua recusada e que as citações oficiais preservam documento, versão, página e link. Não disparar chamadas pagas ou ampliar acesso apenas por seguir este roteiro.

Checkpoint local: branch `feat/eva-contextual-conversation`, baseada em `main` `99a784646a70b7efd110a45657ca34fc9087c6a7`. Alterações disponíveis no diff local, sem commit/push/PR/merge/deploy nesta etapa. Sem mudanças em banco, migrações, grants, flags, índice ou licenças. Piloto, 73 fragmentos, publicações e reserva histórica pendente preservados. A melhoria de conversa usa resolução textual conservadora; não representa memória persistente nem homologação de todas as perguntas do modelo em produção.

## Complemento validado — pergunta da captura

“quais documentos para ser agente na ccee” agora recebe `CONTEXT_REQUIRED` com a pergunta sobre o perfil do participante, sem afirmar uma lista de documentos nem consumir IA. A resposta curta “consumidor” mantém a pergunta original para nova recuperação nas fontes autorizadas. Perguntas que já informam o perfil seguem para a recuperação existente.

Quando o RAG retorna READY e a geração se abstém, o chat distingue a existência de trechos oficiais da insuficiência para uma resposta completa: pede contexto e identifica os links como trechos recuperados para conferência. Não libera texto não sustentado do modelo e não reduz o controle de números, vigências ou publicação.

Validação atualizada: 227 testes em 11 suítes Jest aprovados, build Nest aprovado e os três testes DOM aprovados. O teste DOM inclui a frase literal da captura, entrada vazia, esclarecimento visível sem o aviso de falta de resposta comprovada e envio da resposta curta com a pergunta anterior. O build Next aprovado da etapa anterior continua aplicável: este complemento mudou apenas backend, testes e documentação. `git diff --check` aprovado. RAG legado e migração do corpus mantêm os hashes originais conferidos.

Situação de publicação: main remoto conferido novamente em `99a784646a70b7efd110a45657ca34fc9087c6a7`; alterações permanecem locais. Consulta pública à aplicação bloqueada pelo proxy (HTTP403 no túnel), sem acesso aos painéis de Railway/Vercel nesta sessão. Portanto o SHA implantado não foi confirmado diretamente e não se declara homologação viva. Nenhum convite, mensagem, chamada de IA, reindexação ou alteração de dados foi executado.
