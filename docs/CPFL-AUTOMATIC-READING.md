# CPFL: reconhecimento e início automático da leitura

O upload de fatura da distribuidora inicia a fila OCR através do endpoint existente, respeitando permissão, licença e configuração. Falha de enfileiramento preserva o arquivo e informa o operador; não há retry de envio implícito. A tela consulta o estado inicial e acompanha apenas trabalhos ativos a cada 5 segundos.

O reconhecedor aceita a classificação explícita da primeira página quando Azure não a retorna como par chave/valor. Número fiscal, série, CNPJ do cliente e endereço podem ser extraídos do bloco delimitado por UC e nota fiscal, preservando spans e evidência de palavras. Confiança de transcrição não substitui confiança semântica.

O subtotal Devolução impresso como magnitude positiva só é interpretado como crédito quando as parcelas assinadas e o total final coincidem exatamente. A interpretação fica exposta na conciliação, mantendo texto e valores originais.

Validação: suíte backend completa (156 suítes, 2697 testes antes dos dois testes adicionais de cabeçalho); regressões posteriores de cabeçalho, vínculo e conciliação; builds backend e frontend. Extração de produção preservada, sem nova chamada Azure: 24 operações, identificação 8/8, dados fiscais 3/3, colunas 11/11 e quatro reconciliações exatas. Dados pessoais da fatura não foram incluídos nas fixtures.

Limites: esta entrega não cria confirmações humanas nem aprova automaticamente cadastros incompletos. Integrações financeiras ainda exigem as validações existentes. O caso testado tem cadastro com endereço incompleto e ambiente de mercado não informado, além de leituras de demanda arredondadas divergentes entre medição e histórico. Automação integral até apuração permanece pendente, e não deve ser anunciada como concluída.
