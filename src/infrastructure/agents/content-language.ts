/**
 * The one place the content language is stated. Every agent/skill that
 * writes player-facing text interpolates this into its system prompt
 * instead of restating the rule in its own words — the first eval run
 * caught Dev writing every drop and shop item in English because only
 * Story's prompt mentioned a language at all. Same single-source rule as
 * city-template.value-object.ts applies to counts.
 */
export const CONTENT_LANGUAGE_INSTRUCTION = `LANGUAGE: write every player-facing string in Brazilian Portuguese (pt-BR) —
names, lore, dialogue, quest text, flavor text, item names and item
descriptions alike, matching the rest of the game's text. Common nouns
inside a name are translated too (a "Crypt Dust" drop is "Pó da Cripta").
Only ids stay as short kebab-case ASCII slugs.`;
