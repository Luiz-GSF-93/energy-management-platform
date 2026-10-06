# Mapa — agregações, raio e Score de economia (etapa 4)

## Escopo e autorização
As leituras existentes do mapa preservam as verificações atuais no backend e no banco. Gestor, Operador e Administrador da organização consultam somente a organização de sua sessão, com permissões de mapa/clientes e licença vigente. O mapa global exige o único vínculo global vigente de Administrador da plataforma e a permissão de organizações. Funções de leitura não são executáveis por anon/authenticated; continuam privadas ao backend. Nenhum dado privado é publicado em dataset Mapbox.

## Agregações comerciais — PORTFOLIO_COUNTS_V1
Contagens de unidades, clientes distintos e localizações conferidas por estado, distribuidora e combinação ACL/ACR/UNKNOWN + GD + BESS. São calculadas no mesmo comando SQL e sobre toda a seleção filtrada, antes da paginação. Não são extrapoladas da página atual. Um cliente em vários grupos é contado em cada grupo; somar grupos não fornece clientes únicos. A visão global conserva clientes sem unidade, que contribuem para clientes e para zero unidades. Classificação desconhecida permanece desconhecida.

Estados e perfis mostram todos os grupos; distribuidoras exibem as 20 maiores carteiras e o número total de grupos. O heatmap existente usa peso uniforme e somente as coordenadas conferidas da página: descreve densidade, sem presumir economia ou potencial comercial. Sua cobertura permanece explicitamente indicada.

## Raio — HAVERSINE_6371_V1
Centro em latitude/longitude WGS84, entre -90/90 e -180/180; raio entre 1 e 500 km, até três casas decimais. Centro e raio precisam estar completos. Fórmula Haversine com raio terrestre de 6371 km e proteção numérica no intervalo 0–1. Distância geográfica aproximada em linha reta, não distância rodoviária ou polígono territorial. Localizações declaradas como rua/CEP/cidade permanecem aproximadas; o filtro não as torna mais precisas.

Somente coordenadas conferidas com hash/endereço e cliente atuais participam. Localizações desatualizadas, pendentes e clientes sem unidade não são inventados nem incluídos no círculo. Os demais filtros, totais e agregações aplicam-se ao mesmo recorte; paginação ocorre depois dele. Distância retornada com três casas decimais. Não chama geocodificador, não gera cobrança Mapbox adicional e não usa localização do navegador.

## Score de economia — PUBLISHED_ECONOMY_AFTER_FEES_V1
Autorizado pelo usuário como Score de economia publicado. É o percentual já produzido pelo motor financeiro: soma da economia após honorários dividida pela soma do ACR das últimas versões publicadas no período, multiplicada por 100. Usa os totais exatos em centavos do backend e seu arredondamento para duas casas decimais. Não tira média simples de percentuais mensais, não recalcula cenários nem adiciona honorários novamente.

Valores negativos ou superiores a 100 permanecem visíveis; não há truncamento, ponderação arbitrária ou rótulo de eficiência energética física. Se não houver publicação ou ACR for zero, o percentual é indisponível. Meses ausentes não são zero nem projetados. O cartão informa período, cobertura, método e versões/grupos/hashes imutáveis utilizados. Apurações com ressalvas conservam os avisos. Revisão futura depende de nova publicação validada, nunca da alteração de uma versão histórica.

## Validação e limitações
Teste SQL com migrations reais e mais de 1000 unidades comprova agregações independentes da paginação, escopo e licença, raio vazio/limite/distâncias, endereço stale, GD+BESS, clientes sem unidade e execução negada ao navegador. Testes backend validam filtros completos e rejeitam overrides e números malformados. Testes DOM validam ação explícita, centro conferido, limpeza, grupos completos e texto seguro; score mantém sinal, método, origem e indisponibilidade.

A geometria usa o cálculo geográfico PostgreSQL existente, sem introduzir PostGIS ou reescrever infraestrutura. Em carteiras de grande porte, avaliar índices espaciais e planos de execução com métricas reais antes de ampliar o piloto. Limites da fila de geocodificação continuam 10/org/dia e 100 globais/mês.
