# Avaliação climática anual isolada

Nova política `climate-cycle/2.0`, solicitada explicitamente pelo backoffice (`weather.assessment=ANNUAL_CYCLE_2`). Requisições antigas mantêm a política 1.0; snapshots existentes não são recalculados. A fórmula aplicada é `consumption-forecast/1.4`; quando rejeitada, preserva integralmente o cálculo sem clima e sua versão. Não altera ACL, CCEE, OCR, apuração financeira, autenticação ou publicação.

## Avaliação

36 meses consecutivos e conferidos, com 24 meses iniciais para treinamento e 12 origens mensais cobrindo um ciclo anual. Avalia horizontes de 1 a 6 meses disponíveis em cada origem (57 previsões sobrepostas). Recalcula média dos mesmos meses/período, tendência linear e referência sazonal nas mesmas observações de teste. Não reutiliza os erros do teste antigo de seis origens.

Compara média histórica da temperatura dos mesmos meses e referência do ano anterior. Escolhe o cenário em uma avaliação interna de seis origens somente dentro do treinamento de cada origem externa. Temperatura observada do período de teste não alimenta a previsão daquela origem. Empates favorecem média histórica. Esses cenários não são previsão meteorológica nem normal climatológica. O motor usa regressão com tendência, harmônicos sazonais e temperatura, com QR reortogonalizada e rejeição de colinearidade/valores inválidos.

Aceitação exige ganho de MAE estritamente superior a 10% contra a melhor referência global sem clima e melhora em pelo menos 8/12 origens contra essa mesma referência. É política de aceitação, não significância estatística; previsões sobrepostas não são amostras independentes e não há intervalo calibrado. Erros por horizonte ficam visíveis. Não selecionar candidatos por resultados futuros completos, nem ajustar limiar para favorecer a unidade piloto.

## Datas e evidências

NASA POWER passa a persistir temperaturas diárias no novo snapshot, com fonte/hash/consulta. Sem datas documentadas e com dias iguais aos civis, permite diagnóstico explicitamente aproximado, mas não aplica clima mesmo se houver ganho. Dias incompatíveis, temperatura ausente, períodos duplicados ou referências incorretas bloqueiam a avaliação/aplicação.

O operador pode conferir datas nas fontes da versão aberta e informar os períodos na nova requisição. Leitura anterior exclusiva e atual inclusiva; dias precisam corresponder aos aprovados, períodos precisam ser consecutivos, cada competência deve apontar o `evidenceId` da observação autorizada e a página documental. Datas inexistentes são inválidas. Nenhuma data é preenchida por estimativa ou inventada a partir da regularidade mensal. Essas informações são premissas, persistidas na requisição imutável, que exigem conferência humana na validação existente; o motor não altera os históricos OCR aprovados.

## Sensibilidade e implantação

A Zulmira foi caracterizada pelo usuário como pouco afetada por temperatura. Registrar `sensitivity=LOW`, com justificativa, sem presumir carga térmica. Graus-dia não foram ativados para esta unidade: exigiriam atividade de aquecimento/refrigeração e temperatura-base documentadas, não informadas. Consumo ou demanda não é reduzido por emissões evitadas.

Resumo público contém apenas erros agregados, motivos padronizados, alinhamento e sensibilidade; não encaminha coordenadas, coeficientes, fontes ou justificativas privadas. Mantém consulta restrita ao cliente vinculado e somente versões validadas e publicadas. Backoffice e portal usam a mesma apresentação dos resultados do backend.

Aplicar migração `20261009_energy_forecast_climate_cycle.sql` antes do backend: apenas acrescenta fórmula 1.4 à lista aceita da função de preparação existente, preservando corpo, grants, RLS e transições. Validar regressões, subir branch/PR e verificar deploy. Homologar como nova versão preliminar com fontes reais da Zulmira. A v4 e qualquer publicação permanecem preservadas. Validação/publicação continuam manuais; sem ganho/datas suficientes, a média continua correta e a pendência fica explícita.
