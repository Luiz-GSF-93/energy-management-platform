# Medições CCEE: hora de referência

O atendimento 00450944, fornecido pelo usuário em 27/10/2026, confirmou que `periodo/fim` identifica a hora 00 a 23. A hora 00 corresponde aos doze intervalos de cinco minutos entre 00:05 e 01:00. Não representa o fim de um intervalo horário.

Cada consulta diária usa início 00:00:00-03:00 e fim 23:59:59-03:00 do mesmo dia. O offset é preservado no XML. FINAL tem fim inclusivo; CONSOLIDADA tem fim exclusivo. A janela diária escolhida funciona para ambos. A seleção COLETA existente é preservada, sem somar outra série INSPECAO à mesma hora.

A numeração de página pertence à paginação, e não ao dia do mês: cada chamada diária ListarMedida começa na página 1. A listagem de pontos mantém sua paginação real.

Novos resultados carregam `data.timeSemantics=CCEE_HOUR_LABEL_V2`; cada linha contém `hourLabel` e conserva `end` como nome legado compatível. O hash identifica essa metodologia. Não há alteração de resultados anteriores ou migração de tabelas.

CSV e conciliação distinguem V2 e legado. No V2, a coluna CSV chama-se `hora_referencia`, a cobertura mensal começa na hora 00 do primeiro dia e o agrupamento diário não subtrai uma hora. A base de consumo comparada continua sendo o período mensal fechado, com perdas documentadas. Registros antigos sem o marcador conservam o comportamento V1.

Cobertura completa exige as 24 horas únicas do dia e o total de horas do mês, com grandeza/unidade e qualidade verificadas. A 25a hora do dia seguinte é rejeitada na janela diária, sem descarte silencioso. Falhas, ausência de fonte e medidas estimadas não são convertidas em zero ou resultado final. Reativo permanece separado do consumo ativo.

Testes cobrem bordas FINAL/CONSOLIDADA, offset, ano bissexto, meses de 28/29/30/31 dias, página 1 por dia, duplicidades, ponto, unidade, qualidade, somas, CSV, conciliação V2 e compatibilidade V1.

Homologação real autorizada: até 35 novas chamadas SOAP para setembro/2026 e verificações complementares, interrompendo na primeira falha funcional. Sem registro externo, pagamento ou publicação financeira automática. PLD horário mantém a agenda existente; coleta privada de cinco minutos ainda depende de medidor e homologação própria. Novos serviços e rotinas contínuas exigem configuração concreta por organização.
