# Janela histórica da previsão

A preparação consolida fontes validadas da mesma organização, cliente e unidade e confere conflitos antes de escolher a janela. A seleção usa até 36 competências mais recentes, consecutivas e encerradas na competência de corte. Exige no mínimo 12 meses. Lacunas ou conflitos inclusive em meses antigos bloqueiam a preparação.

As fontes completas permanecem no snapshot. O campo historyWindow registra versão, estratégia, meses disponíveis/selecionados, limites e meses excluídos apenas do cálculo. Os hashes incluem essa seleção. Requisições repetidas continuam retornando a versão original; versões anteriores não são recalculadas.

Com 44 meses de jan/2023 a ago/2026, a execução usa set/2023 a ago/2026 e preserva jan–ago/2023 nas fontes. A consulta NASA usa somente o intervalo selecionado.

O motor existente permanece intacto: média diária disponível com 12 meses; a partir de 18 meses compara também tendência e, quando elegível, sazonalidade. Clima continua opcional e condicionado aos critérios existentes. Esta alteração não força média para qualquer histórico menor que 36, não reduz limites de aprovação e não infere datas de leitura.

Sem migração, novos privilégios, alteração de CCEE, OCR original ou cálculo financeiro. A qualificação da janela aparece pela apresentação existente. Dados reais e documentos privados não fazem parte deste commit.
