# Comparativo financeiro ACL

Fluxo completo simulado com ACR/ACL, encargos, honorários, investimento no instante zero e saldo acumulado. Não equivale a faturamento realizado, benefício regulatório, proposta assinada ou economia publicada.

ACR usa tarifas TE com fonte e conciliação, tarifas TUSD informadas, demanda medida como hipótese, bandeira proporcional e débitos comuns mensais editáveis. Automação sugere débitos comuns positivos; ressarcimentos eventuais não se repetem. Mês documental preserva total e quantidades faturadas. Demais meses usam histórico aprovado e GD estatística do piloto.

ACL 100% remove GD, TE e bandeira ACR; considera energia com perdas/ICMS conforme premissas, desconto TUSD somente ponta/demanda, contribuição e ERR+ERCAP sobre o total ACR mensal simulado. Não reaplica tributos na TUSD. Honorário variável = percentual × máximo(0, ACR menos ACL antes de honorários); fixo todo mês.

ROI do horizonte = (economia operacional acumulada menos investimento) / investimento × 100; não anualiza. Investimento zero torna ROI/payback não aplicáveis. Payback simples por saldo acumulado, interpolado no mês. Se o saldo volta a negativo, descarta recuperação anterior. Não extrapola além da vigência nem aplica taxa de desconto não definida. Valores monetários usam inteiros/razões exatas e HALF_UP por componente.

Revisão independente exige usuário autorizado diferente do autor, fontes atuais, hash imutável e atividade de viabilidade. Conferências: fontes, custos, GD, fluxo e limitações. Parecer favorável, desfavorável ou condicional. Favorável exige economia operacional positiva e saldo após investimento não negativo. Apenas favorável libera evidência/conclusão da viabilidade. Não autoriza contrato, CCEE ou suprimento automaticamente.

Modelos/revisões são privados por organização, cliente, unidade e vínculo. Servidor recalcula ao registrar e verifica fontes na revisão, evidência e encerramento. Portal mantém somente status/resumo autorizado. Versões antigas preservadas; envelope legado parcial mantém compatibilidade e fluxo completo tem fórmula própria acl-financial/1.
