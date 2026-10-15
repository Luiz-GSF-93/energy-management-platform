import {questionText} from './bot-energy-question';

const normalized=(text:string)=>questionText(text).trim().replace(/[?!.]+$/,'').trim();
const vague=(text:string)=>/^(?:(?:oi|ola|bom dia|boa tarde|boa noite)[, ]*)?(?:me ajuda|pode me ajudar|preciso de ajuda|tenho uma duvida|como faco|como funciona|qual (?:e )?(?:o )?prazo|pode explicar(?: melhor)?|explique(?: melhor)?|nao entendi|e agora|e depois|e o prazo|como assim|isso|e isso)?$/.test(normalized(text));
const continuation=(text:string)=>/^(?:e\b|mas\b|sobre isso\b|nesse caso\b|neste caso\b|entao\b|pode (?:explicar|detalhar|resumir)\b|explique\b|resuma\b|nao entendi\b|como assim\b)|\b(?:isso|disso|desse processo|dessa etapa)\b/.test(normalized(text));
const participantProfile=(text:string)=>/\b(?:consumidor[a]?|gerador[a]?|comercializador[a]?|distribuidor[a]?|varejista|conectad[oa]|representad[oa])\b/.test(normalized(text));
const cceeEnrollment=(text:string)=>/\bccee\b/.test(normalized(text))&&/(?:\b(?:ser|tornar|virar)\b.*\bagente\b|adesao|aderir|ingressar|participar|(?:document|cadastr).*\bagente\b)/.test(normalized(text));
const needsParticipant=(text:string)=>cceeEnrollment(text)&&!participantProfile(text);
const profileReply=(text:string)=>text.length<=160&&participantProfile(text)&&!/[?]/.test(text)&&!/^(?:como|qual|quais|onde|quando|quem|por que)\b/.test(normalized(text));
const contextualize=(question:string):{question:string;clarification?:string}=>needsParticipant(question)?{question,clarification:'Para eu conferir os documentos aplicáveis na CCEE, você quer participar como consumidor, gerador ou comercializador? Se não souber o perfil, me conte o que a empresa pretende fazer.'}:{question};

/** User text only: this resolves intent, never evidence, authorization or source values. */
export function evaConversation(question:string,previousQuestion?:string):{question:string;clarification?:string}{
 const current=question.trim(),previous=previousQuestion?.trim();
 if(previous&&(continuation(current)||vague(previous)||needsParticipant(previous)&&profileReply(current))){
  if(vague(previous)&&vague(current))return {question:current,clarification:'Claro, vamos por partes. Você quer ajuda com uma fatura, uma regra da CCEE ou algum módulo do EnergyOS?'};
  const resolved=`${previous}\nContinuação: ${current}`;
  if(resolved.length>500)return {question:current,clarification:'Para eu acompanhar sem misturar os assuntos, sobre qual processo ou fatura é essa pergunta?'};
  return contextualize(resolved);
 }
 if(vague(current))return {question:current,clarification:/prazo/.test(normalized(current))?'Você quer saber o prazo de qual etapa ou processo? Pode me dizer com suas palavras.':'Claro, vamos por partes. Você quer ajuda com uma fatura, uma regra da CCEE ou algum módulo do EnergyOS?'};
 return contextualize(current);
}
