import { test } from "node:test";
import assert from "node:assert/strict";
import { OrchestrateContentGenerationUseCase } from "./orchestrate-content-generation.use-case";
import { GenerateStoryUseCase } from "./generate-story.use-case";
import { GenerateAssetsUseCase } from "./generate-assets.use-case";
import { GenerateDevContentUseCase } from "./generate-dev-content.use-case";
import { LoadTargetRepoConventionsUseCase } from "./load-target-repo-conventions.use-case";
import { AssemblePackageUseCase } from "./assemble-package.use-case";
import { ValidatePackageUseCase } from "./validate-package.use-case";
import type { IStoryAgent } from "../ports/story-agent.port";
import type { IArtAgent } from "../ports/art-agent.port";
import type { IDevAgent } from "../ports/dev-agent.port";
import type {
  ITargetRepoConventions,
  TargetRepoConventions,
} from "../ports/target-repo-conventions.port";
import type { IManifestWriter } from "../ports/manifest-writer.port";
import type { StoryManifest } from "../../domain/value-objects/story-manifest.value-object";
import type { AssetManifest } from "../../domain/value-objects/asset-manifest.value-object";
import type { DevContent } from "../../domain/value-objects/dev-content.value-object";
import type { ContentPackage } from "../../domain/entities/content-package.entity";

const STORY: StoryManifest = {
  zoneId: "pirate-cove",
  zoneName: "Pirate Cove",
  lore: "A smugglers' harbor lost to fog.",
  atmosphereKeywords: ["salt-worn wood", "fog", "rust"],
  levelRange: { min: 15, max: 20 },
  npcs: [
    {
      id: "harbor-master",
      name: "Old Bess",
      role: "QUEST_GIVER",
      personality: "gruff",
      dialogueHooks: ["Watch the tide."],
    },
  ],
  quests: [
    {
      id: "clear-the-bilge-rats",
      title: "Clear the Bilge Rats",
      narrative: "Rats overran the docks.",
      giverNpcId: "harbor-master",
      objectiveSketch: "defeat 5 bilge rats",
    },
  ],
  monsters: [
    { id: "bilge-rat", name: "Bilge Rat", flavor: "unafraid of water", threatTier: "trivial" },
  ],
};

const ASSETS: AssetManifest = {
  zoneId: "pirate-cove",
  assets: [
    {
      entityId: "harbor-master",
      relativePath: "assets/npcs/harbor-master.png",
      source: "generated",
      sourceDetail: "prompt",
      transparent: true,
    },
    {
      entityId: "bilge-rat",
      relativePath: "assets/monsters/bilge-rat.png",
      source: "generated",
      sourceDetail: "prompt",
      transparent: true,
    },
  ],
};

const DEV: DevContent = {
  zoneId: "pirate-cove",
  map: { mapId: "pirate-cove-map", name: "Pirate Cove", width: 50, height: 50, isCity: false },
  npcPlacements: [{ npcId: "harbor-master", position: { x: 10, y: 10, z: 0 } }],
  questObjectives: [
    {
      questId: "clear-the-bilge-rats",
      objectiveType: "KILL_MONSTER",
      objectiveTarget: "bilge-rat",
      objectiveRequiredCount: 5,
      minLevel: 15,
      expReward: 100,
      goldReward: 50,
      itemRewardIds: [],
      prerequisiteQuestIds: [],
    },
  ],
  monsterStats: [
    {
      monsterId: "bilge-rat",
      level: 15,
      maxHp: 80,
      attack: 12,
      defense: 4,
      expReward: 20,
      goldReward: 5,
      respawnTimeSeconds: 30,
      spawnPositions: [{ x: 12, y: 12, z: 0 }],
    },
  ],
};

class RecordingFakeStoryAgent implements IStoryAgent {
  calls: string[] = [];
  async generate(brief: string): Promise<StoryManifest> {
    this.calls.push(brief);
    return STORY;
  }
}

class RecordingFakeArtAgent implements IArtAgent {
  received?: StoryManifest;
  async generate(story: StoryManifest): Promise<AssetManifest> {
    this.received = story;
    return ASSETS;
  }
}

class RecordingFakeDevAgent implements IDevAgent {
  received?: { story: StoryManifest; conventions: TargetRepoConventions };
  async generate(
    story: StoryManifest,
    conventions: TargetRepoConventions,
  ): Promise<DevContent> {
    this.received = { story, conventions };
    return DEV;
  }
}

class FakeTargetRepoConventions implements ITargetRepoConventions {
  async load(): Promise<TargetRepoConventions> {
    return { backendRules: "fake rules", frontendRules: null, ticketWorkflow: null };
  }
}

class RecordingFakeManifestWriter implements IManifestWriter {
  written?: ContentPackage;
  async write(pkg: ContentPackage): Promise<string> {
    this.written = pkg;
    return `/fake/output/${pkg.zoneId}/manifest.json`;
  }
}

function buildOrchestrator() {
  const storyAgent = new RecordingFakeStoryAgent();
  const artAgent = new RecordingFakeArtAgent();
  const devAgent = new RecordingFakeDevAgent();
  const conventions = new FakeTargetRepoConventions();
  const writer = new RecordingFakeManifestWriter();

  const orchestrator = new OrchestrateContentGenerationUseCase(
    new GenerateStoryUseCase(storyAgent),
    new LoadTargetRepoConventionsUseCase(conventions),
    new GenerateAssetsUseCase(artAgent),
    new GenerateDevContentUseCase(devAgent),
    new AssemblePackageUseCase(),
    new ValidatePackageUseCase(),
    writer,
  );

  return { orchestrator, storyAgent, artAgent, devAgent, writer };
}

test("orchestrator runs Story first, then Art/Dev off its output, then writes a merged package", async () => {
  const { orchestrator, storyAgent, artAgent, devAgent, writer } = buildOrchestrator();

  const { package: pkg, manifestPath } = await orchestrator.execute({
    brief: "a coastal pirate town, level 15-20",
    outputRoot: "/fake/output",
    backendPath: "/fake/mmorpg-backend",
  });

  assert.equal(storyAgent.calls[0], "a coastal pirate town, level 15-20");
  // deepEqual, not equal: GenerateStoryUseCase re-validates through
  // StoryManifestSchema.parse(), which returns a fresh object — same
  // shape, different reference, which is the correct behavior.
  assert.deepEqual(artAgent.received, STORY);
  assert.deepEqual(devAgent.received?.story, STORY);
  assert.equal(devAgent.received?.conventions.backendRules, "fake rules");

  assert.equal(pkg.zoneId, "pirate-cove");
  assert.equal(writer.written, pkg);
  assert.equal(manifestPath, "/fake/output/pirate-cove/manifest.json");
});

test("orchestrator throws with every violation when Dev drifts from Story", async () => {
  class DriftingDevAgent implements IDevAgent {
    async generate(): Promise<DevContent> {
      // A non-empty but wrong placement — passes zod's shape validation
      // (still >=1 items) so the failure we're asserting on is really the
      // referential-integrity check, not schema validation catching an
      // empty array first.
      return {
        ...DEV,
        npcPlacements: [{ npcId: "someone-story-never-mentioned", position: { x: 1, y: 1, z: 0 } }],
      };
    }
  }

  const orchestratorWithDrift = new OrchestrateContentGenerationUseCase(
    new GenerateStoryUseCase(new RecordingFakeStoryAgent()),
    new LoadTargetRepoConventionsUseCase(new FakeTargetRepoConventions()),
    new GenerateAssetsUseCase(new RecordingFakeArtAgent()),
    new GenerateDevContentUseCase(new DriftingDevAgent()),
    new AssemblePackageUseCase(),
    new ValidatePackageUseCase(),
    new RecordingFakeManifestWriter(),
  );

  await assert.rejects(
    () =>
      orchestratorWithDrift.execute({
        brief: "a coastal pirate town, level 15-20",
        outputRoot: "/fake/output",
        backendPath: "/fake/mmorpg-backend",
      }),
    /unknown npcId 'someone-story-never-mentioned'/,
  );
});
