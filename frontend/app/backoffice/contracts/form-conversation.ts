export type ConversationField = {
  key: string; label: string; value: string | null; kind: 'decimal' | 'text' | 'date' | 'choice';
  required?: boolean; promptWhenEmpty?: boolean; reviewRequired?: boolean; question?: string; unit?: string; decimals?: number; maxLength?: number;
  choices?: Record<string, string>;
};
const normalize = (s: string) => s.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** A human reply targets one visible field. Ambiguous values never become writes. */
export function conversationValue(field: ConversationField, reply: string): string {
  const text = reply.trim();
  if (!text || text.length > (field.maxLength ?? 2000)) throw Error('Informe uma resposta dentro do limite do campo.');
  if (field.kind === 'text') return text;
  if (field.kind === 'choice') {
    const matches = Object.entries(field.choices ?? {}).filter(([key, label]) => [normalize(key), normalize(label)].includes(normalize(text)));
    if (matches.length !== 1) throw Error('Responda com uma das opções indicadas, sem presumir a classificação.');
    return matches[0][0];
  }
  if (field.kind === 'date') {
    const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const value = br ? `${br[3]}-${br[2]}-${br[1]}` : text;
    if (!/^(20|21)\d{2}-(0[1-9]|1[0-2])-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw Error('Informe uma data válida: DD/MM/AAAA ou AAAA-MM-DD.');
    return value;
  }
  if (/\b(nao|talvez|aproximad\w*|ou|entre)\b|[?<>−-]/.test(normalize(text))) throw Error('Confirme um único valor exato, sem alternativas ou sinal negativo.');
  const numbers = text.match(/\d[\d.,]*/g) ?? [];
  if (numbers.length !== 1) throw Error('Informe somente o valor deste campo. Identifique a página no campo de fonte.');
  const givenUnit = text.match(/\b(kwh|kvarh|mwh|kw)\b/i)?.[1];
  if (givenUnit && field.unit && normalize(givenUnit) !== normalize(field.unit)) throw Error(`A unidade deste campo é ${field.unit}. Não vou converter ou trocar a grandeza automaticamente.`);
  const remainder = normalize(text.replace(numbers[0], '').replace(/\b(kwh|kvarh|mwh|kw)\b/ig, '').replace(/R\$|%/g, ''));
  const words = new Set(normalize(field.label).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).concat(['o','a','e','eh','valor','medido','medida','foi','de','da','do','consumo','demanda','reais','real']));
  if (remainder.replace(/[.:=(),]/g, ' ').split(/\s+/).filter(Boolean).some(w => !words.has(w))) throw Error('Responda o valor do campo solicitado. Para dúvidas, use a consulta de fontes; nenhuma instrução livre altera outros campos.');
  let number = numbers[0];
  if (number.includes(',')) {
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d+$/.test(number)) throw Error('Confira os separadores do número. Exemplo: 47.856,5325.');
    number = number.replace(/\./g, '').replace(',', '.');
  } else if (/^\d+\.\d{3}$/.test(number)) throw Error('O ponto pode indicar milhar ou decimal. Use vírgula decimal ou informe o inteiro sem separadores.');
  if (!/^\d+(?:\.\d+)?$/.test(number)) throw Error('Confira os separadores do número.');
  const [whole, fraction] = number.split('.');
  const integer = BigInt(whole).toString();
  if (integer.length > 12 || (fraction?.length ?? 0) > (field.decimals ?? 6)) throw Error('O valor excede a precisão ou o limite permitido para este campo.');
  return integer + (fraction ? '.' + fraction : '');
}

export function conversationNote(notes: string, field: ConversationField, value: string, evidence: string, max = 2000) {
  const line = `Bot-Energy · resposta do operador · ${field.label}: ${field.value ?? 'não informado'} → ${value}. Evidência declarada: ${evidence.trim() || 'conferir fonte do formulário'}.`;
  const next = [notes.trim(), line].filter(Boolean).join('\n');
  if (next.length > max) throw Error('O histórico desta sessão excedeu o espaço das observações. Salve a etapa e revise as observações antes de continuar; nenhuma evidência será cortada.');
  return next;
}
