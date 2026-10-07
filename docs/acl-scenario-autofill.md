# Preenchimento de cenários ACL

Uma versão imutável de estudo funciona como modelo de premissas de simulação. O backoffice seleciona o processo e a versão de origem aos quais tem acesso, então solicita preenchimento pela fatura atual. Estudos rejeitados são recusados; versões ainda sem revisão ficam explicitamente identificadas.

O endpoint privado POST /acl-admissions/:id/scenario-draft valida organização, vínculos, permissões e licenças separadamente na origem e no destino. O histórico atual deve estar aprovado; hash de arquivo, unidade, cliente e resultado do job OCR vigente são conferidos. Nenhum novo arquivo é enviado a um provedor. A interpretação usa o OCR já preservado e regras do layout, sem geração de valores por modelo de linguagem.

Reutiliza preço, perdas, ICMS, honorários, desconto TUSD, contribuição, estimativa ERR+ERCAP, investimento e método estatístico GD. Não copia textos privados do cliente do modelo, consumo, resultados, créditos ou tarifas antigas. A vigência é herdada do modelo e exige conferência do início e da validade da proposta na unidade atual. Todas as confirmações ficam desmarcadas.

As três tarifas TUSD vêm das linhas da fatura atual, com unidade, quantidade, fonte documental, página e conciliação aritmética. Para linhas de demanda com tributações diferentes, somente uma linha de base ICMS igual ao valor e alíquota positiva pode ser sugerida; ambiguidades deixam o campo vazio. Falta de confiança OCR fica destacada; confiança abaixo de45% e origem não verificada impedem sugestão. Suporte inicial CPFL Paulista Grupo A; layouts ainda não homologados mantêm digitação/revisão das exceções.

Conferir sugestões → simular → registrar versão interna → revisão independente. O rascunho não grava estudo nem aprova viabilidade; resultados são recalculados no servidor pelo fluxo existente. Não publica portal, contrata, migra ou altera apurações. Modelo compartilhado requer acesso ao processo de origem: não expõe premissas de clientes sem vínculo. A lista de versões usa a primeira página autorizada (até50); não há preset organizacional público/global ou publicação de proposta comercial.
