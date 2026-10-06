# Classificação energética por unidade

O ambiente de contratação ACL/ACR (`free_market`) é independente da participação em GD (`has_gd`) e da presença de armazenamento BESS (`has_bess`). Os três campos são booleanos anuláveis: `null` significa não informado; `false` é ausência conferida. Nenhum cadastro existente é classificado por inferência.

Em Clientes e unidades, abra a edição da unidade e configure os três campos. A mesma gravação auditada preserva justificativa, autor, valores anteriores e novos, versão otimista e idempotência. Clientes com várias unidades podem ter combinações diferentes. Campos também estão disponíveis no DTO de criação da API.

O mapa oferece filtros independentes para mercado, GD e BESS antes da paginação. Marcadores GD são roxos; BESS acrescenta contorno âmbar. Detalhes preservam ACL/ACR mesmo quando o marcador tem GD. Agrupamentos e concentração continuam representando quantidade de unidades localizadas, sem atribuir uma categoria única ao grupo.

Somente o administrador da plataforma acessa o mapa global. As consultas organizacionais preservam as verificações existentes de organização, papel e licença. Não há novo endpoint de edição no mapa: a alteração usa a permissão vigente de edição cadastral.

A migração f12 acrescenta duas colunas sem valores padrão e estende a função de edição existente por substituição guardada de sua lista de campos. Se a definição implantada tiver mudado, a transação falha e deve ser revisada. As funções de consulta mantêm seus grants existentes.

Validação: testes PostgreSQL embarcado de combinações, filtros globais/organizacionais, isolamento, valores nulos, idempotência, conflito de versão, histórico imutável e rollback se auditoria falhar; validação DTO e filtros; formulário auditado e GeoJSON; regressões de mapa, concentração e regionalização; builds backend e frontend.
