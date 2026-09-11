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
import {
  buildValidStory,
  buildValidAssets,
  buildValidDev,
} from "../../test-support/valid-city.fixture";

const STORY = buildValidStory();
const ASSETS = buildValidAssets(STORY);
const DEV = buildValidDev(STORY);

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
    return `/fake/output/${pkg.cityId}/manifest.json`;
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

  assert.equal(pkg.cityId, "test-city");
  assert.equal(writer.written, pkg);
  assert.equal(manifestPath, "/fake/output/test-city/manifest.json");
});

test("orchestrator throws with every violation when Dev drifts from Story", async () => {
  class DriftingDevAgent implements IDevAgent {
    async generate(): Promise<DevContent> {
      // A non-empty but wrong placement — passes zod's shape validation
      // (still the required 8 items) so the failure asserted on below is
      // really the referential-integrity check, not schema validation
      // catching a wrong-length array first.
      const dev = buildValidDev(STORY);
      dev.npcPlacements = dev.npcPlacements.map((p, i) =>
        i === 0 ? { ...p, npcId: "someone-story-never-mentioned" } : p,
      );
      return dev;
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
    /npcPlacements must place exactly the npcs/,
  );
});
