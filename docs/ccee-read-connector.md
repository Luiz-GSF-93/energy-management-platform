# Conector CCEE — primeira etapa de leitura

O teste local do usuário confirmou SOAP HTTP 200 e retorno do perfil autorizado. Essa evidência não confirma as permissões para medições de todas as unidades nem o funcionamento do certificado no Railway.

## Implementado

- TLS 1.2 com validação do servidor e autenticação pelo PFX protegido; WS-Security com usuário e senha sistêmicos.
- Host fixo de produção; somente `listarPerfilParticipanteMercado` e `listarPLD`. Sem redirects, retries, contratos ou operações de escrita na CCEE.
- Rotas `GET /api/v1/admin/integrations/ccee`, `POST .../test` e `POST .../pld-preview`, exclusivamente no contexto global do administrador com permissão de consulta de organizações. Não expostas no Portal.
- Prévia `{ "month": "2026-08" }`: valida perfil antes de ler PLD, percorre páginas limitadas, exige todos os intervalos horários do mês e quatro submercados. Média aritmética horária em R$/MWh, sem tributos. Não publica nem grava preços no dashboard.
- Respostas possuem organização vinculada por configuração no servidor, proveniência e hashes das páginas. O cliente não escolhe perfil, organização, URL ou credenciais nas rotas.
- Falhas retornam mensagens locais; XML, senhas, PFX e mensagens brutas do fornecedor não são registrados nem retornados.

## Variáveis do serviço backend no Railway

| Nome | Conteúdo | Tratamento |
|---|---|---|
| `CCEE_READ_ENABLED` | `false` inicialmente; `true` somente para validação autorizada | Bloqueio de chamadas |
| `CCEE_ORGANIZATION_ID` | ID exato da organização Expert Energy no banco | Vínculo único, conferir antes de ativar |
| `CCEE_PROFILE_CODE` | Código do perfil autorizado na CCEE | Não confundir com CNPJ |
| `CCEE_USERNAME` | Usuário sistêmico da Plataforma de Integração | Inserção direta no serviço |
| `CCEE_PASSWORD` | Senha do usuário sistêmico | Segredo; não é a senha do PFX |
| `CCEE_PFX_BASE64` | Conteúdo completo do PFX protegido convertido para base64 | Segredo; base64 não é criptografia |
| `CCEE_PFX_PASSWORD` | Senha criada na exportação do PFX | Segredo separado |
| `CCEE_SERVER_CA_PEM` | Opcional: cadeia CA oficial verificada do servidor, quando exigida pelo runtime | Nunca desabilitar validação TLS |

O usuário deve inserir os segredos diretamente no Railway. Não anexar PFX, base64 ou senhas no chat, repositório, log ou frontend. Não gerar nova chave/CSR. Status `configured` valida a abertura do PFX, mas somente `/test` confirma autenticação remota.

## Pendências para concluir integração

1. Configurar os segredos e confirmar o teste a partir do backend implantado.
2. Validar uma prévia real de PLD com permissões do perfil e resposta atual do serviço.
3. Adicionar armazenamento idempotente com revisão/publicação e consumo pelo dashboard existente. Não tratar uma prévia como dado publicado.
4. Associar perfis representados e pontos de medição às unidades por vínculo autorizado, antes de consultar dados privados de clientes.
5. Conectar medições/encargos ao motor financeiro existente por nova versão, sem substituir valores aprovados ou duplicar documentos manuais.

Sem worker, agendamento ou importação automática nesta etapa. O vínculo único é uma restrição inicial; não permite representar outras organizações por inferência.

Fonte técnica: [coleção oficial da CCEE](https://github.com/devccee/postman-collections) e [guia oficial](https://github.com/devccee/guia-primeiros-passos).
