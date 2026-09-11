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
import type {
  ICheckpointStore,
  Checkpoint,
} from "../ports/checkpoint-store.port";
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
  calls = 0;
  received?: StoryManifest;
  async generate(story: StoryManifest): Promise<AssetManifest> {
    this.calls++;
    this.received = story;
    return ASSETS;
  }
}

class RecordingFakeDevAgent implements IDevAgent {
  calls = 0;
  received?: { story: StoryManifest; conventions: TargetRepoConventions };
  async generate(
    story: StoryManifest,
    conventions: TargetRepoConventions,
  ): Promise<DevContent> {
    this.calls++;
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

/** In-memory stand-in for FileCheckpointStore — same port, no filesystem,
 * so checkpoint/resume behavior is testable without touching disk. */
class InMemoryCheckpointStore implements ICheckpointStore {
  private readonly byRunId = new Map<string, Checkpoint>();
  async load(runId: string): Promise<Checkpoint | null> {
    return this.byRunId.get(runId) ?? null;
  }
  async save(runId: string, checkpoint: Checkpoint): Promise<void> {
    this.byRunId.set(runId, checkpoint);
  }
}

function buildOrchestrator(checkpoints: ICheckpointStore = new InMemoryCheckpointStore()) {
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
    checkpoints,
  );

  return { orchestrator, storyAgent, artAgent, devAgent, writer, checkpoints };
}

test("orchestrator runs Story first, then Art/Dev off its output, then writes a merged package", async () => {
  const { orchestrator, storyAgent, artAgent, devAgent, writer } = buildOrchestrator();

  const { package: pkg, manifestPath } = await orchestrator.execute({
    brief: "a coastal pirate town, level 15-20",
    outputRoot: "/fake/output",
    backendPath: "/fake/mmorpg-backend",
    runId: "run-1",
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
    new InMemoryCheckpointStore(),
  );

  await assert.rejects(
    () =>
      orchestratorWithDrift.execute({
        brief: "a coastal pirate town, level 15-20",
        outputRoot: "/fake/output",
        backendPath: "/fake/mmorpg-backend",
        runId: "run-drift",
      }),
    /npcPlacements must place exactly the npcs/,
  );
});

// ── Checkpoint/recovery: the actual point of this feature ──
// A real crash mid-pipeline is simulated here by having Dev fail on its
// first call. The checkpoint saved after Story succeeds should mean a
// SECOND orchestrator instance, sharing the same checkpoint store and
// runId, resumes without re-invoking Story or Art — proving recovery
// doesn't re-pay for work already finished.
test("resuming after a failure skips already-completed phases", async () => {
  const checkpoints = new InMemoryCheckpointStore();

  class FailsOnceDevAgent implements IDevAgent {
    calls = 0;
    async generate(): Promise<DevContent> {
      this.calls++;
      if (this.calls === 1) throw new Error("simulated crash");
      return DEV;
    }
  }

  const firstAttempt = buildOrchestrator(checkpoints);
  const failingDevAgent = new FailsOnceDevAgent();
  const firstOrchestrator = new OrchestrateContentGenerationUseCase(
    new GenerateStoryUseCase(firstAttempt.storyAgent),
    new LoadTargetRepoConventionsUseCase(new FakeTargetRepoConventions()),
    new GenerateAssetsUseCase(firstAttempt.artAgent),
    new GenerateDevContentUseCase(failingDevAgent),
    new AssemblePackageUseCase(),
    new ValidatePackageUseCase(),
    firstAttempt.writer,
    checkpoints,
  );

  await assert.rejects(
    () =>
      firstOrchestrator.execute({
        brief: "a coastal pirate town, level 15-20",
        outputRoot: "/fake/output",
        backendPath: "/fake/mmorpg-backend",
        runId: "run-resume",
      }),
    /simulated crash/,
  );

  // Story and Art already ran once; a checkpoint for the "story" phase
  // must exist even though the overall run failed.
  assert.equal(firstAttempt.storyAgent.calls.length, 1);
  assert.equal(firstAttempt.artAgent.calls, 1);

  // A brand new orchestrator (simulating a fresh `npm run generate
  // --run-id run-resume` process) sharing the same checkpoint store.
  const secondAttempt = buildOrchestrator(checkpoints);
  const { package: pkg } = await secondAttempt.orchestrator.execute({
    brief: "a coastal pirate town, level 15-20",
    outputRoot: "/fake/output",
    backendPath: "/fake/mmorpg-backend",
    runId: "run-resume",
  });

  assert.equal(pkg.cityId, "test-city");
  // The whole point: resuming must NOT call Story again — its checkpointed
  // result from the first attempt is reused as-is. Art/Dev run together
  // as one checkpoint phase (they're dispatched in the same
  // Promise.all — see orchestrate-content-generation.use-case.ts), so a
  // crash before THAT phase finished means both get redone on resume;
  // only Story's own, earlier phase was safely checkpointed.
  assert.equal(secondAttempt.storyAgent.calls.length, 0);
  assert.equal(secondAttempt.artAgent.calls, 1);
});

test("resuming a run that already finished returns the cached package without calling any agent", async () => {
  const checkpoints = new InMemoryCheckpointStore();
  const first = buildOrchestrator(checkpoints);

  const firstResult = await first.orchestrator.execute({
    brief: "a coastal pirate town, level 15-20",
    outputRoot: "/fake/output",
    backendPath: "/fake/mmorpg-backend",
    runId: "run-done",
  });

  const second = buildOrchestrator(checkpoints);
  const secondResult = await second.orchestrator.execute({
    brief: "a coastal pirate town, level 15-20",
    outputRoot: "/fake/output",
    backendPath: "/fake/mmorpg-backend",
    runId: "run-done",
  });

  assert.deepEqual(secondResult, firstResult);
  assert.equal(second.storyAgent.calls.length, 0);
  assert.equal(second.artAgent.calls, 0);
  assert.equal(second.devAgent.calls, 0);
});
