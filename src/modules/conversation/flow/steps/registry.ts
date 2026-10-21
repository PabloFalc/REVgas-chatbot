import type { AskFn, HandleFn, Step } from '../flow.types';

export const asks: Partial<Record<Step, AskFn>> = {};

export const handlers: Partial<Record<Step, HandleFn>> = {};
