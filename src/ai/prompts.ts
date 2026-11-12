// The prompts and JSON schemas. One JSON Schema drives both engines: Gemini Nano gets it as the Prompt API's
// responseConstraint, the cloud model as responseJsonSchema, so both return the same shape.

import { INTENTS, KINDS, PERIODS } from '../book/types';
import { plainShillings } from '../check/numbers';

export const READING_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: [...KINDS] },
    items: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          quantity: { type: 'number' },
          unit_price: { type: 'number' },
          line_total: { type: 'number' },
        },
        required: ['name', 'quantity', 'unit_price', 'line_total'],
      },
    },
    total: { type: 'number' },
    currency: { type: 'string' },
    person: { type: 'string' },
    due: { type: 'string' },
  },
  required: ['kind', 'items', 'total', 'currency', 'person', 'due'],
} as const;

export const QUERY_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: [...INTENTS] },
    person: { type: 'string' },
    item: { type: 'string' },
    period: { type: 'string', enum: [...PERIODS] },
  },
  required: ['intent', 'person', 'item', 'period'],
} as const;

const KIND_RULES = `kind is one of:
- sale: sold and paid now
- debt: sold on credit; the person will pay later. If the message says when they will pay ("she pays Friday", "will pay
  later") or that they owe, kind is debt, never sale
- payment: a person paid back money they owed
- expense: money spent on running the shop (rent, electricity, transport, airtime for the shop)
- purchase: stock bought from a supplier`;

export function readPrompt(words: string, shopCurrency: string): string {
  return `You keep the books for a small shop. Turn the owner's message into one record.
${KIND_RULES}
items: each thing in the message, with quantity, unit_price (the price of one) and line_total (quantity x unit_price).
total: the sum of the line totals.
currency: a 3-letter code. R or rand is ZAR, KSh or Kenyan shillings is KES, TSh or Tanzanian shillings is TZS, USh or Ugandan shillings is UGX, shillings alone is ${plainShillings(shopCurrency)}, Rs or rupees is INR, CFA is XOF, $ or dollars is USD. If the message names no currency, use ${shopCurrency}.
person: the customer or supplier the message names, or "" if none. due: when they will pay, as the message says it, or "".
Use only the numbers in the message. "X each" or "@ X" means X is the unit_price.

Examples:
"Sold 2 Cokes at R12 each to Sipho, he pays tomorrow" -> kind debt, Coke quantity 2 unit_price 12 line_total 24, total 24, person Sipho, due tomorrow
"Sold 2 Cokes at R12 each" -> kind sale, total 24, person "", due ""
"Sipho paid R24" -> kind payment, total 24, person Sipho

Message: """${words}"""`;
}

export function secondOpinionPrompt(words: string, shopCurrency: string, problems: string[]): string {
  return `${readPrompt(words, shopCurrency)}

A first reading of this message failed these checks:
${problems.map((p) => `- ${p}`).join('\n')}
Read the message again carefully and return a corrected record. People's names and phone numbers were replaced with placeholders such as [PERSON_1]; copy a placeholder exactly where the name belongs.`;
}

export function receiptPrompt(shopCurrency: string): string {
  return `You keep the books for a small shop. This is a photo of a supplier's receipt or invoice. Turn it into one record.
kind: purchase for stock for resale, expense for anything else.
items: every line on the receipt, with quantity, unit_price and line_total as printed. If a line shows only a total, use quantity 1.
total: the receipt's total to pay.
currency: a 3-letter code (R is ZAR). If none is printed, use ${shopCurrency}.
person: the supplier's business name as printed. due: "".`;
}

export function receiptSecondOpinionPrompt(shopCurrency: string, problems: string[]): string {
  return `${receiptPrompt(shopCurrency)}

A first reading of this photo failed these checks:
${problems.map((p) => `- ${p}`).join('\n')}
Read every line and the total again and return a corrected record.`;
}

export function askPrompt(question: string, today: string): string {
  return `A shop owner is asking a question about their own books. Do not answer it. Say what to look up.
intent is one of:
- owed_by: how much one named person owes
- who_owes: who owes money, or how much is owed in all
- sales_total: how much was sold
- expenses_total: how much was spent
- profit: how much was made or lost
- top_items: what sold best
- item_sales: how much of one item was sold
person: the person named, or "". item: the item named, or "".
period: today, yesterday, this_week, this_month or all (all when the question names no time).
Today is ${today}.

Question: """${question}"""`;
}
