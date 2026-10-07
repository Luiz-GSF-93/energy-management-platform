# ACL: encargos e GD no estudo interno

Fórmula `acl-supplier-preview/4`, com corpos anteriores preservados. Resultado parcial: não encerra Viabilidade, não publica economia no portal e não autoriza contratação.

## Premissas editáveis

- Custo mensal adicional identificado pela composição (piloto: contribuição associativa R$350).
- ERR+ERCAP: percentual estimado sobre o **total a pagar da fatura de referência** (piloto: 9%). Não incide sobre preço do fornecedor, honorários ou investimento. Varia com sazonalidade e mercado; não representa cobrança CCEE real.
- Investimento de homologação separado dos custos mensais (piloto: R$9.300), editável; ROI/payback pendentes do fluxo completo.

## Comparativo do mês documentado

O servidor consulta somente a leitura OCR da versão documental aprovada e vinculada à organização, cliente e unidade do processo. Quantidades faturadas são distintas dos históricos arredondados. Linhas financeiras devem conciliar em centavos com o total, sem duplicar subtotais ou devoluções. Linhas desconhecidas, sem fonte, duplicadas ou divergentes bloqueiam a comparação.

No cenário hipotético 100% ACL, energia TE/bandeiras ACR e créditos GD são substituídos pela energia do fornecedor. TUSD ponta e demanda recebem a premissa de desconto; fora de ponta permanece integral. Despesas comuns e ressarcimentos são mantidos no mesmo mês, sem repetição anual automática. Honorários: fixo + percentual sobre diferença positiva antes dos honorários. Valores negativos indicam ACL mais caro naquele mês. Não comprova elegibilidade regulatória ou benefício contratado.

## GD histórica estatística, adesão explícita

Premissa autorizada para o piloto: GD fora de ponta faturada / consumo fora de ponta faturado × **consumo total** do mês histórico. Mantém a razão exata; percentual exibido é informativo. A aplicação ao consumo total é uma hipótese informada pelo usuário, embora a fatura comprove compensação fora de ponta.

Usa as mesmas tarifas de crédito GD da referência, preservando TE e TUSD separadas. Crédito de bandeira sem tarifa unitária impressa é proporcionalmente estimado e identificado. O mês histórico da referência mantém os créditos documentados em vez de reestimá-los. Os demais meses são marcados como estimativa estatística para comparação econômica. Reutilização sazonal em meses futuros não garante créditos futuros.

Histórico aprovado não é modificado. Estimativa não significa saldo de créditos disponível, valor contabilizado ou economia publicada. Revisão independente confere fontes e premissas; nunca transforma um estudo parcial em aprovação financeira.

## Controles

Cálculos no servidor com decimais/BigInt e arredondamento HALF_UP em centavos. Interface envia premissas, sem resultados calculados pelo navegador. Registro requer atividade Viabilidade em andamento, revisão atual, fontes aprovadas, idempotência e versão imutável. Gateway privado, licença, escopo multitenant e proibição de autorrevisão permanecem vigentes. Portal recebe apenas status e resumo final explicitamente aprovado.

## Ajuste por variação de consumo

Método configurável e preservado na versão: limitar o percentual pela participação do consumo total mensal no consumo total faturado da referência (exemplo: referência GD71,6%, consumo relativo65%, aplicação65%); alternativa explícita de reduzir proporcionalmente (71,6%×65%=46,54%). Nenhum método aumenta a proporção nos meses de consumo maior. O consumo e o percentual usados aparecem por mês. O ajuste reduz a hipótese frente à aplicação constante; não comprova geração/compensação real.

Premissa anterior de redução proporcional substituída pelo usuário: piloto usa subtração da queda de consumo em pontos percentuais. GD aplicada = max(0, proporção GD de referência − max(0, 1 − consumo total mensal/consumo total faturado de referência)). Exemplo: referência71,6%, queda6%, aplicação65,6%. Piso zero e teto no percentual de referência; queda calculada individualmente por mês. Esse ajuste é conservador quanto ao benefício estimado de GD; créditos menores podem favorecer ACL e não garantem uma decisão de migração conservadora.
