# F1.98 — Diagnóstico da confiança OCR da CDE

A confiança baixa da descrição não representa a confiança dos valores numéricos. O painel CDE passa a mostrar a menor confiança entre quantidade, tarifa bruta, valor e ICMS/PIS/Cofins, o percentual individual por campo e as palavras da descrição que exigem revisão, com página de origem.

Diagnóstico da leitura preservada da Del Rei agosto/2026: a palavra “Hídrica” recebeu 29,9% na ponta e 24,6% fora ponta; “CDE” e “Escassez” receberam acima de 99%. Os valores conferidos pelo usuário não foram alterados. Não houve nova chamada Azure nem aumento artificial da confiança.

As palavras só são apresentadas após validar spans, páginas, cobertura integral, texto e confiança pela mesma rotina de evidência de transcrição. Campo sem origem verificável permanece sem confiança disponível. A confiança direta do campo, quando existente, prevalece sobre a das palavras. O mínimo numérico não usa médias e não ignora campo ausente.

A projeção é somente leitura: não modifica OCR armazenado, conferências, autor, histórico, parâmetros, limiar >85% ou aprovação. A descrição CDE permanece pendente de conferência; esta entrega não homologa a fatura nem libera a integração. É necessário tratar a descrição com evidência ou revisão auditada antes de liberar os rascunhos.

Validação: testes de evidência, candidatos e serviço CDE, DOM do painel e builds backend/frontend. Sem migração de banco.
