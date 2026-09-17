/**
 * A narrow, independently-callable, reusable unit of agent capability —
 * distinct from the two concepts it sits next to:
 *   - a PORT (IStoryAgent/IArtAgent/IDevAgent) is what OUR code uses to
 *     call a model for one of the three fixed pipeline stages;
 *   - a USE-CASE is a step the Master orchestrator runs as part of that
 *     fixed Story -> {Art, Dev} -> merge -> validate sequence.
 * A Skill is neither — it's invoked ON DEMAND, outside that sequence,
 * when only one small piece of an already-generated package needs to be
 * (re)produced. See GenerateShopInventorySkill for the first concrete
 * example: regenerating a single NPC's shop inventory without rerunning
 * Story/Art/Dev for the whole city.
 */
export interface Skill<TInput, TOutput> {
  readonly name: string;
  execute(input: TInput): Promise<TOutput>;
}
