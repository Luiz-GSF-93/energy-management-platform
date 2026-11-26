ATUALIZACAO DE IMPLANTACAO - 18/11/2026: o painel Railway informa que novos servicos nao podem adotar o antigo Config as Code. No passo 2 abaixo, substituir a selecao de railway.json pela configuracao direta do novo servico: raiz /services/pee-core-api, builder Dockerfile, caminho /services/pee-core-api/Dockerfile, watch /services/pee-core-api/** e health /health. A primeira implantacao no projeto independente EnergyOS-PEE foi concluida; /health respondeu 200 com enabled=false e ready=false, e as rotas de negocio responderam 503. A ativacao funcional continua pendente. Nenhum banco, segredo ou servico existente foi alterado.

# EnergyOS - PEE: instalacao independente

Preparacao em 18/11/2026, branch `install/pee-core-integration-20261118`.
Base atualizada: `dad85887d341667902872964a147ba190046e9d6` (PR #665).

## Isolamento

Esta alteracao acrescenta somente arquivos novos. Nao modifica backend,
frontend, autenticacao, permissoes, licencas existentes, migracoes, Dockerfile
raiz ou configuracao Railway raiz. O servico fica em `services/pee-core-api`.
O workflow novo executa testes apenas em pull requests, sem implantacao.
A configuracao raiz do Railway observa backend e arquivos de build existentes;
ela nao observa a nova pasta. Confirmar tambem as regras reais no painel.

## Primeira implantacao: desligada

1. Criar um NOVO servico Railway, inicialmente separado da producao EnergyOS.
2. Selecionar esta branch, raiz `/services/pee-core-api`, arquivo de configuracao
   `/services/pee-core-api/railway.json` e Dockerfile `Dockerfile` na raiz do servico.
3. Manter `PEE_CORE_ENABLED=false`, health check `/health`; usar `PORT` do Railway.
4. Confirmar a imagem e o contexto de build. Nao editar os servicos existentes.
5. Verificar HTTP 200 em `/health` com `enabled:false`, `ready:false`, e 503 nas
   rotas de negocio. Saude nesse modo significa processo vivo, nao produto pronto.
6. Nao aplicar `schema.sql` no banco atual do EnergyOS. Reservar um projeto
   Supabase dedicado ao PEE e revisar o SQL antes de qualquer aplicacao.

O modo desligado nao exige credenciais nem conecta banco, provedor de assinatura,
banco comercial ou IA. Existem cinco testes locais aprovados; ainda falta build
real no Railway e homologacao entre os sistemas. A interface demonstrativa nao
esta sendo publicada como aplicacao autenticada por esta alteracao.

## Core e protocolo de acesso

A recuperacao da ultima publicacao local do Core identifica `0.21.0-rc.58`,
`mfa-supplier-portal-r1`. A consulta ao Azure confirmou a API em execucao, revisao
`energy-core-api--0000206`, com endereco interno. A imagem exata em execucao
precisa ser comparada com a candidata antes de publicar qualquer integracao.

O Core usa sessoes opacas, cookies HttpOnly, origem/CSRF e permissoes individuais.
O pacote Core preparado separadamente inclui codigo de uso unico, vinculo fixo
de tenant, troca autenticada e revalidacao. Ainda nao foi implantado.

O gateway desta pasta continua sendo referencia de contratacao com RS256; nao
aceita automaticamente esse protocolo opaco. Implementar o callback `/sso/core`
e compatibilizar as duas pontas antes de habilitar. Nao copiar cookies/senhas,
nao tratar sessao opaca como JWT, nem conceder acesso por e-mail ou role enviada
pelo navegador. Nao tornar a API interna do Core publica para facilitar a conexao.
Preparar uma ponte restrita entre servidores e manter os segredos somente neles.

## Pendencias para uso real

- Autorizacao Core em cada operacao, tenant e perfil explicitamente concedidos.
- Persistencia dos projetos, anexos privados e isolamento RLS por organizacao.
- Reserva e consumo atomicos das cotas; rastreabilidade dos projetos gerados.
- Contratacao de terceiros, assinatura pelo provedor real do Core e liberacao
  posterior pelo Owner. Assinatura isolada nunca equivale a liberacao de acesso.
- Licencas vigentes, revogacao e eventos financeiros de royalties, sem cobrancas
  ou assinaturas reais como testes. Minutas exigem revisao juridica.
- EVA restrita ao preenchimento PEE e fontes oficiais, sem acesso a pagamentos,
  assinaturas, terminal, e-mails ou dados de outros tenants. Nao ha modelo ativo.
- Homologacao de dois tenants, usuario Core sem permissao, expiracao, logout,
  revogacao, replay, idempotencia, backup/retorno e monitoramento.

O subdominio `pee.energy-os.app.br` e uma proposta. DNS/TLS nao foram alterados.
Nao ativar `PEE_CORE_ENABLED=true` ate concluir essas integracoes e a homologacao.
Para retornar a preparacao, manter o servico desligado; nao apagar bancos ou
alterar os segredos e as protecoes dos servicos atuais.

Referencias oficiais de configuracao:
- https://docs.railway.com/deployments/monorepo
- https://supabase.com/docs/guides/getting-started/api-keys
