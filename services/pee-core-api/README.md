# EnergyOS - PEE: servico independente

Preparacao de instalacao em ambiente separado, desligada por padrao.

- Node 24, sem dependencias de execucao adicionais.
- `npm test` executa os cinco testes do servico.
- `npm start` inicia desligado sem banco, assinatura ou cobranca.
- `/health` declara `enabled:false` e `ready:false`; rotas de negocio retornam 503.
- Nao habilitar antes da homologacao com o Core.

Consulte `../../docs/integrations/pee-core-installation.md` e `.env.example`.
O gateway de referencia usa RS256; o Core usa sessoes opacas. Essa referencia
nao e automaticamente compativel com a ponte de acesso preparada no Core.
Nao copiar senhas ou cookies do Core para o PEE e nao reutilizar segredos.

Licencas, assinatura digital, royalties e EVA ainda exigem integracoes reais.
O prototipo demonstrativo nao equivale a uma aplicacao autenticada de producao.
