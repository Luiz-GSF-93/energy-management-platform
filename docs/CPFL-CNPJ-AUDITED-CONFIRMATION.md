# CNPJ completo CPFL com baixa confiança

Permite exclusivamente conferência humana auditada do CNPJ completo coincidente com cadastro e com dígitos verificadores válidos. Exige layout CPFL, origem/páginas, ausência de documento duplicado e correspondência dos outros cinco campos da identidade. Valores conflitantes, fontes desconhecidas e problemas adicionais permanecem bloqueados.

A confirmação exige Gestor/Administrador, permissão existente, checkbox de conferência no PDF e justificativa de pelo menos 20 caracteres. O snapshot preserva a confiança original, os candidatos e os campos auxiliares, vinculados pelo hash. Alteração da origem/cadastro invalida a confirmação atual; versões anteriores são imutáveis. Não modifica a avaliação automática do OCR nem aprova apuração.

Usa a persistência existente para comparação EQUAL, sem migração, novas permissões ou variáveis.
