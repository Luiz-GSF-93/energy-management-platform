# F1.109 — Conciliação de valores das parcelas de demanda

A conferência de demanda passa a exibir quantidade em kW, tarifa bruta em R$/kW, valor faturado, produto arredondado e confiança mínima dos campos. Cada linha é conciliada separadamente, inclusive quando as parcelas utilizada e não utilizada possuem tarifas diferentes.

A aritmética utiliza inteiros com nove casas decimais e arredondamento HALF_UP em centavos. Divergência de um centavo já exige revisão. Fonte ambígua, unidade incorreta, precisão excessiva ou confiança insuficiente impedem estado conciliado. A evidência permanece fora do snapshot assinado das classificações existentes.

Não converte demanda faturada em medida, não presume ICMS zero/isenção, não soma novamente tributos embutidos nem cria ou aprova parâmetros. A separação de quantidades e tratamentos das parcelas é uma condição para a próxima integração tarifária; o parâmetro agregado de 500 kW não deve receber uma tarifa única derivada das duas linhas.

Validação: testes de aritmética, confiança, origem, classificação, histórico e interface; build backend, TypeScript frontend e diffcheck. Sem migração ou reprocessamento Azure.
