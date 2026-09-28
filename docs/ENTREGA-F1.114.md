# F1.114 — Bases tributárias das parcelas de demanda

A preparação identifica as duas tarifas de demanda integradas pelo OCR e aprovadas, confere suas fontes e classificações atuais e propõe versões das declarações de ICMS, PIS e Cofins com as seis bases TUSD, CDE e demanda. ICMS sem destaque na parcela não utilizada é excluído desta declaração; não é presumido como isenção ou zero. Tributos já embutidos não geram nova cobrança.

A ação fica em Preparar apuração, junto à integração das parcelas OCR. Preenche as bases automaticamente por tributo, sem alterar declarações aprovadas. A aprovação usa a substituição atômica existente, ampliada de quatro para seis bases, com validação das revisões, bloqueio de concorrência, autor e histórico. Erro na aprovação desfaz também a retirada da versão anterior.

Valores, parcelas e classificações incompatíveis bloqueiam a ação. Tokens vinculam a versão atual da fonte e dos parâmetros; IDs determinísticos impedem duplicação. Sem mudança de permissões ou nova chamada ao Azure.

Validação: 48 testes backend, 40 verificações transacionais de banco, 13 verificações da nova interface e 12 da integração de demanda; TypeScript e builds backend/frontend aprovados. Migração aplicada no Supabase com sucesso antes da publicação dos novos endpoints.
