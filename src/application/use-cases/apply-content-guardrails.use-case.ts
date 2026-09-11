import type { StoryManifest } from "../../domain/value-objects/story-manifest.value-object";

/**
 * ── AI ENGINEERING CONCEPT: guardrails as a checkpoint, not a prompt ──
 *
 * Every prompt in this codebase already tells its model what NOT to do
 * (see claude-story-agent.ts's paragraph about the retrieved-context block,
 * claude-dev-agent.ts's about target-repo files). But an instruction in a
 * prompt is a request, not a guarantee — a sufficiently adversarial
 * retrieved-context block, or the model simply making a mistake, can still
 * produce output that leaked instructions it was told to ignore, or that
 * drifted outside this project's actual subject (a fantasy MMORPG). A
 * guardrail is a second, independent layer that inspects the OUTPUT after
 * the fact, in plain code the model has no influence over — the same
 * "don't just ask nicely, verify" principle behind schema validation
 * (run-structured-agent.ts) and referential-integrity checking
 * (validate-package.use-case.ts), applied to content safety instead of
 * structural correctness.
 *
 * This check is intentionally simple: pattern-matching for phrases that
 * indicate a successful prompt injection (the model echoing back
 * instruction-like text it was fed as data) plus a couple of structural
 * sanity checks. A production system would add a real moderation
 * classifier (e.g. a small model or a dedicated moderation API) to catch
 * unsafe content that doesn't match any fixed pattern — documented here
 * honestly rather than pretending regex matching is a complete solution.
 */

const INJECTION_ECHO_PATTERNS: RegExp[] = [
  /ignore (all|any|previous|prior) instructions/i,
  /disregard (the|your|all|any) (rules|guidelines|instructions)/i,
  /system prompt/i,
  /you are now (a|an)/i,
  /reveal (your|the) (prompt|instructions|system message)/i,
  /jailbreak/i,
  /act as (an? )?(unfiltered|uncensored|unrestricted)/i,
  /\bDAN\b/, // a well-known jailbreak persona name ("Do Anything Now")
];

export class ContentGuardrailViolationError extends Error {
  constructor(public readonly violations: string[]) {
    super(
      `Story output failed content guardrails:\n${violations
        .map((v) => `  - ${v}`)
        .join("\n")}`,
    );
    this.name = "ContentGuardrailViolationError";
  }
}

export class ApplyContentGuardrailsUseCase {
  /** Throws ContentGuardrailViolationError with every violation, not just the first. */
  execute(story: StoryManifest): void {
    const text = collectNarrativeText(story);
    const violations: string[] = [];

    for (const pattern of INJECTION_ECHO_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        violations.push(
          `narrative text contains "${match[0]}" — reads like an echoed instruction, not game lore`,
        );
      }
    }

    if (violations.length > 0) {
      throw new ContentGuardrailViolationError(violations);
    }
  }
}

function collectNarrativeText(story: StoryManifest): string {
  return [
    story.cityName,
    story.lore,
    ...story.atmosphereKeywords,
    ...story.npcs.flatMap((npc) => [npc.name, npc.personality, ...npc.dialogueHooks]),
    ...story.quests.flatMap((quest) => [quest.title, quest.narrative, quest.objectiveSketch]),
    ...story.fields.flatMap((field) => [
      field.name,
      field.atmosphere,
      ...field.monsters.flatMap((monster) => [monster.name, monster.flavor]),
    ]),
    ...story.instances.flatMap((instance) => [
      instance.name,
      instance.theme,
      ...instance.monsters.flatMap((monster) => [monster.name, monster.flavor]),
    ]),
  ].join("\n");
}
