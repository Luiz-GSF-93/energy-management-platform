# CCEE: vínculo assistido, DRI e referências PLD

Incremento de 09/11/2026 sobre a PR #585. Preserva lançamentos publicados e permissões existentes.

O vínculo recebe cliente, instalação, endereço e CNPJ do cadastro. O servidor consulta o participante confirmado por CNPJ ou pelo vínculo aprovado da mesma unidade. Perfis e pontos são sugestões: UC não é código de ponto, perfil principal de mercado não comprova sozinho perfil principal SCDE, adesão não comprova vigência de representação. O operador confirma instalação, escopo, evidência e vigência; o salvamento segue como minuta no fluxo existente.

Consultas utilizam o certificado no Railway, validação de organização/ator/unidade/contexto/catálogo, reserva antes de cada chamada, idempotência, lease e orçamento compartilhado. Tarefas têm RLS, sem acesso direto pelo navegador. Nenhuma concessão de representação ou licença é feita.

DRI abre em modal com estados legíveis, andamento e detalhes de origem. Atualizações consultam o resultado local sem novas chamadas SOAP. O trabalhador mensal PLD utiliza o serviço oficial e publica apenas meses encerrados completos nos quatro submercados, com horas e hashes verificados. Respeita programação homologada, licença, ator autorizado e orçamento. Não substitui referências divergentes já publicadas.

Backoffice e portal usam a mesma referência. Sem contrato regular cobrindo o mês, usam referência cadastrada de contrato ativo ou UF conectada mapeada inequivocamente, com aviso da origem geográfica. Isso não altera apurações aprovadas nem comprova modelagem CCEE. Conflitos e UF sem mapeamento seguro continuam sem referência. Atualização visual a cada minuto fica suspensa durante conferência anual selecionada e publicação.

Validação: parsers, trabalhador, regressões de preços, testes DOM do vínculo/modal e PGlite para escopo, lease, idempotência, orçamento, completude mensal, licença, RLS e proibição de sobrescrita. Builds e verificações CI antecedem publicação. Validação real deve distinguir sucesso da API privada de ausência de participante ou representação, sem inventar dados.
