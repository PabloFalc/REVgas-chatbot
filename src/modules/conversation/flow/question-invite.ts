import { normalizeText } from 'src/utils/text';

const GREETING = '(?:(?:oi|ola|bom dia|boa tarde|boa noite) )?';
const SUBJECT = '(?:eu )?';
const DET = '(?:uma |umas |algumas |minha |minhas )?';
const NOUN = '(?:duvidas?|perguntas?)';
const YOU = '(?:voce|vc|vcs|voces)';

const INVITES = [
  `(?:tenho|to com|tou com|estou com) ${DET}${NOUN}`,
  `posso (?:te )?(?:perguntar|(?:fazer|tirar) ${DET}${NOUN})(?: uma coisa| algo)?`,
  `(?:quero|queria|gostaria de) (?:tirar|fazer) ${DET}${NOUN}`,
  `(?:quero|queria|gostaria) que ${YOU} (?:tire|tirasse|responda|respondesse) ${DET}${NOUN}(?: minhas?| comigo| pra mim)?`,
  `(?:me )?tira ${DET}${NOUN}(?: minhas?| pra mim)?`,
].map(body => new RegExp(`^${GREETING}${SUBJECT}${body}$`));

function words(text: string): string {
  return normalizeText(text)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isQuestionInvite(text: string): boolean {
  const normalized = words(text);
  return normalized !== '' && INVITES.some(pattern => pattern.test(normalized));
}
