# Ponte EnergyOS – PEE / Energy Core

Etapa de homologação de acesso; não equivale à plataforma PEE completa.
O serviço PEE é independente dos serviços atuais do EnergyOS. Não aplicar
schema.sql no banco atual do EnergyOS nem integrar a branch à main nesta etapa.

## Implantação

1. Revisar arquivos e executar os 14 testes. Publicar no projeto independente
   Railway EnergyOS-PEE com PEE_CORE_ENABLED=false e PEE_ACCESS_ENABLED=false.
2. Conferir a versão atual do Core; o pacote preparado usa a base
   fiscal-national-files-r2. Preservar alterações posteriores.
3. Após autorização de produção e regressão, publicar Core API/Web/Worker com
   controles desligados. Aplicar migrações aditivas 100 e 101 pelo executor
   existente, sem apagar tabelas ou conceder acesso automático.
4. Configurar origens HTTPS exatas, organização Owner e tenant Expert Energy.
   A ponte não autoriza tenants de terceiros.
5. Criar segredo exclusivo de 32 bytes base64url para a ponte e outra chave
   independente de 32 bytes para cookies PEE. Guardar em secrets Azure/Railway;
   nunca no código, logs, documentos ou navegador.
6. Habilitar a saída em um worker Core e o acesso PEE para homologação, com uma
   única réplica PEE. O Owner inicializa o workspace e libera pessoas
   individualmente; o administrador também precisa de liberação para entrar.
7. Testar revogação, logout, validade, tenant incorreto, CSRF e uso único do código.
   Projetos e contratação de terceiros devem continuar bloqueados.

## Operação

Falha na consulta ao Core bloqueia acesso. Não existe autorização offline.
Para interromper, desligar PEE_ACCESS_ENABLED e os controles Core, preservando
auditoria e migrações. Restaurar imagens anteriores sem apagar tabelas.
Antes de aumentar réplicas, implementar transporte de autorização compartilhado.

Faltam armazenamento isolado de projetos, consumo atômico de cotas, contratos
assinados pelo Core, aprovação de licenças, cobrança/royalties, EVA restrita a
fontes oficiais e submissão. O gateway legado não comprova essas integrações.
