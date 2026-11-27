import type { CustomerCandidate } from 'src/modules/customer/contracts/customer.types';
import { isValidCpf, onlyDigits } from 'src/utils/cpf';
import { type FlowTools, MAX_CPF_ATTEMPTS } from './flow.types';

export interface IdentifiedCustomer {
  id: number;
  name: string;
  tagId: number | null;
}

export type IdentityResult =
  | { kind: 'new' }
  | { kind: 'verified'; customer: IdentifiedCustomer }
  | { kind: 'ask' }
  | { kind: 'handoff' };

export type CpfCheck = IdentityResult | { kind: 'mismatch' } | { kind: 'invalid' };

function identified({ id, name, tagId }: CustomerCandidate): IdentifiedCustomer {
  return { id, name, tagId };
}

export async function resolveIdentity(phone: string, tools: FlowTools): Promise<IdentityResult> {
  const candidates = await tools.findCustomers(phone);
  if (candidates.length === 0) return { kind: 'new' };
  if (await tools.isBlocked(phone)) return { kind: 'handoff' };
  const linked = await tools.verifiedCustomer(phone);
  const known = candidates.find(candidate => candidate.id === linked);
  if (known) return { kind: 'verified', customer: identified(known) };
  if (!candidates.some(candidate => candidate.cpf)) return { kind: 'handoff' };
  return { kind: 'ask' };
}

export async function checkCpf(phone: string, typed: string, tools: FlowTools): Promise<CpfCheck> {
  if (!isValidCpf(typed)) return { kind: 'invalid' };
  if (await tools.isBlocked(phone)) return { kind: 'handoff' };
  const digits = onlyDigits(typed);
  const matches = (await tools.findCustomers(phone)).filter(candidate => candidate.cpf === digits);
  if (matches.length > 1) return { kind: 'handoff' };
  if (matches.length === 1) {
    await tools.markVerified(phone, matches[0].id);
    tools.track({ name: 'identity_check', outcome: 'verified' });
    return { kind: 'verified', customer: identified(matches[0]) };
  }
  const attempts = await tools.registerCpfMismatch(phone);
  tools.track({ name: 'identity_check', outcome: 'failed' });
  return attempts >= MAX_CPF_ATTEMPTS ? { kind: 'handoff' } : { kind: 'mismatch' };
}
