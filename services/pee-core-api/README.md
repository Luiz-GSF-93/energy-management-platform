# EnergyOS – PEE: serviço independente

Node 24, sem dependências adicionais. `npm test` executa 14 testes.
`npm start` inicia desativado por padrão, sem banco, assinatura ou cobrança.

## Homologação de acesso pelo Core

`PEE_ACCESS_ENABLED=true` implementa login pela sessão e permissão individual do
Energy Core. Configure os campos separados de `.env.example`. PEE_CORE_ENABLED
deve continuar false: o gateway legado de licenciamento usa outro protocolo.

O Core inicia uma conexão HTTPS de saída para o PEE; sua API interna não fica
exposta. A ponte aceita somente troca de código e consulta de acesso, com
organização e tenant fixos, segredo dedicado e validação em ambas as pontas.
Use exatamente uma réplica PEE e um worker Core nesta homologação. A fila de
autorização fica em memória; reinícios negam solicitações pendentes. Antes de
escalar, implementar transporte compartilhado e novos testes.

O navegador passa por /auth/core/start, /pee/authorize no Core e /sso/core.
Estado vinculado ao navegador e PKCE protegem a troca de código. Códigos duram
60 segundos e são de uso único. Cookies PEE são cifrados, HttpOnly, Secure,
SameSite=Lax e limitados a cinco minutos. Senha e cookies do Core ficam no Core.
Cada consulta autenticada confirma a permissão atual; falhas negam o acesso.

/app confirma apenas acesso, perfil e cota configurada. Projetos, consumo de
cotas, contratação de terceiros, assinatura, royalties, EVA e mensagens ainda
dependem de integração real. /health continua com enabled:false e ready:false;
no modo de acesso também informa access_enabled e core_connected.

Não ativar antes de homologar as duas pontas e configurar identificadores e
segredos exclusivos. Publicar com os dois controles false preserva o modo
desativado anterior. Não copiar senhas/cookies ou reutilizar segredos do Core.
Consulte ../../docs/integrations/pee-core-sso.md e .env.example.
