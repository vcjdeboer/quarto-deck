/**
 * Zod schemas for the lint parts of the stored outline (findings with ids,
 * learning outcomes, cut view). Kept apart from `quarto_deck.ts` so the model
 * file only registers them.
 * @module
 */
import { z } from "npm:zod@4.6.7";
import { LINT_RULES, type RuleId } from "./outline.ts";

/** One lint finding. */
export const StyleIssueSchema = z.object({
  slide: z.number(),
  shown: z.number().nullable().optional(),
  title: z.string(),
  id: z.enum(Object.keys(LINT_RULES) as [RuleId, ...RuleId[]]),
  rule: z.string(),
  level: z.enum(["rule", "hint"]),
  message: z.string(),
  file: z.string(),
  line: z.number(),
});

/** Learning-outcome check. */
export const OutcomeReportSchema = z.object({
  opening: z.number().nullable(),
  closing: z.number().nullable(),
  match: z.boolean().nullable(),
  differences: z.array(z.string()),
  items: z.array(z.object({
    n: z.number(),
    text: z.string(),
    terms: z.array(z.object({ term: z.string(), slides: z.array(z.number()) })),
    slides: z.array(z.number()),
  })),
});

/** Where the time goes. */
export const CutViewSchema = z.object({
  slotMinutes: z.number().nullable(),
  minutesPlanned: z.number(),
  overSlot: z.number().nullable(),
  sections: z.array(z.object({
    title: z.string(),
    slide: z.number().nullable(),
    slides: z.number(),
    minutes: z.number(),
    share: z.number().nullable(),
    longest: z.array(
      z.object({ slide: z.number(), title: z.string(), minutes: z.number() }),
    ),
  })),
});
