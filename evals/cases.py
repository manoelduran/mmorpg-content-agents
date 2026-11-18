"""Golden test cases + metrics for subjective content quality.

Structural correctness (counts, references, pinned existing-city facts) is
already enforced in TS by zod + checkReferentialIntegrity — none of that is
re-checked here. These metrics only cover what code can't decide: does the
content read well, fit the brief, and stay in one language.

Each case is one judge call per metric (evaluation_steps are fixed below,
so DeepEval doesn't spend an extra call generating them).
"""

import json
from pathlib import Path

from deepeval.metrics import GEval
from deepeval.test_case import LLMTestCase, SingleTurnParams

from judge import OpenRouterJudge

EVALS_DIR = Path(__file__).resolve().parent
GOLDENS = json.loads((EVALS_DIR / "goldens.json").read_text(encoding="utf-8"))
JUDGE = OpenRouterJudge()


def load_manifest(golden: dict) -> dict:
    return json.loads((EVALS_DIR / golden["manifest"]).read_text(encoding="utf-8"))


def dump(data) -> str:
    return json.dumps(data, ensure_ascii=False, indent=1)


def all_monster_stats(dev: dict) -> list[dict]:
    return [m for area in dev["fieldMaps"] + dev["instances"] for m in area["monsterStats"]]


# ── Metrics ──────────────────────────────────────────────────────────────

brief_adherence = GEval(
    name="Aderência ao brief",
    evaluation_steps=[
        "Liste os elementos concretos pedidos no brief (input): tema, ambientação, atmosfera, faixa de nível, tipos de inimigos, referências a outras cidades.",
        "Verifique, para cada elemento, se ele aparece de forma reconhecível na lore, nos NPCs, nos campos e nas instâncias (actual output).",
        "Penalize elementos do brief ausentes ou contraditos, e penalize temas que não têm relação com o brief.",
        "Se o brief for curto, avalie se o conteúdo é uma interpretação coerente dele, sem exigir detalhes que ele não pediu.",
    ],
    evaluation_params=[SingleTurnParams.INPUT, SingleTurnParams.ACTUAL_OUTPUT],
    model=JUDGE,
    threshold=0.7,
)

lore_teaching_quests = GEval(
    name="Quests TALK_TO_NPC ensinam lore",
    evaluation_steps=[
        "O input é a lore da cidade; o actual output são as quests do tipo TALK_TO_NPC.",
        "Para cada quest, identifique qual fato concreto da lore (história, lugar, personagem, conflito) o jogador aprende ao completá-la.",
        "Penalize quests cuja narrativa é genérica ('fale com X', 'leve uma mensagem') sem revelar nenhum fato da lore.",
        "Penalize quests que contradizem a lore ou que repetem o mesmo fato que outra quest já ensina.",
    ],
    evaluation_params=[SingleTurnParams.INPUT, SingleTurnParams.ACTUAL_OUTPUT],
    model=JUDGE,
    threshold=0.7,
)

narrative_coherence = GEval(
    name="Coerência narrativa",
    evaluation_steps=[
        "O actual output contém NPCs, quests, campos e instâncias de uma única cidade.",
        "Verifique se as personalidades e diálogos dos NPCs combinam com o papel deles e com a lore.",
        "Verifique se os monstros de cada campo e instância combinam com a atmosfera daquele lugar.",
        "Verifique se as quests de matar monstros fazem sentido com os monstros e lugares descritos.",
        "Penalize contradições, nomes duplicados ou quase duplicados, e erros de digitação em nomes próprios.",
    ],
    evaluation_params=[SingleTurnParams.ACTUAL_OUTPUT],
    model=JUDGE,
    threshold=0.7,
)

language_consistency = GEval(
    name="Consistência de idioma",
    evaluation_steps=[
        "Identifique o idioma da lore e das quests (português do Brasil, normalmente).",
        "Verifique se TODO texto visto pelo jogador no actual output — nomes e descrições de itens, drops e itens de loja — está nesse mesmo idioma.",
        "Nomes próprios de fantasia (de NPCs, monstros, lugares) não contam como mistura de idioma; palavras comuns em outro idioma ('Dust', 'Cloak', 'Stone Chip') contam.",
        "A nota deve ser proporcional à fração de textos no idioma correto.",
    ],
    evaluation_params=[SingleTurnParams.ACTUAL_OUTPUT],
    model=JUDGE,
    threshold=0.8,
)

art_prompt_actionability = GEval(
    name="Prompts de arte acionáveis",
    evaluation_steps=[
        "O input é a atmosfera da cidade; o actual output são prompts de geração de sprite pixel-art, um por entidade.",
        "Para cada prompt, verifique se um artista conseguiria desenhar o sprite só com ele: silhueta, pose, paleta, materiais, acessórios e enquadramento.",
        "Verifique se cada prompt está alinhado à atmosfera da cidade e se deixa claro que é pixel art de MMORPG.",
        "Penalize prompts vagos, prompts quase idênticos entre entidades diferentes e prompts que pedem texto ou elementos impossíveis em um sprite.",
    ],
    evaluation_params=[SingleTurnParams.INPUT, SingleTurnParams.ACTUAL_OUTPUT],
    model=JUDGE,
    threshold=0.7,
)


# ── Test cases ───────────────────────────────────────────────────────────

def build_cases(golden: dict) -> list[tuple[str, LLMTestCase, GEval]]:
    """Returns (case_id, test_case, metric) triples. A golden can opt out of a
    metric via `"skip": {"<metric-key>": "<why>"}` when its data legitimately
    doesn't fit that metric (see goldens.json)."""
    manifest = load_manifest(golden)
    story, dev = manifest["story"], manifest["dev"]
    city = golden["cityId"]

    story_view = {
        "cityName": story["cityName"],
        "lore": story["lore"],
        "atmosphereKeywords": story["atmosphereKeywords"],
        "levelRange": story["levelRange"],
        "npcs": story["npcs"],
        "fields": story["fields"],
        "instances": story["instances"],
    }
    talk_quests = [q for q in story["quests"] if q["objectiveType"] == "TALK_TO_NPC"]
    player_facing_items = {
        "drops": [
            {"itemName": d["itemName"], "description": d.get("description")}
            for monster in all_monster_stats(dev)
            for d in monster.get("drops", [])
        ],
        "shopItems": [
            {"itemName": i["itemName"], "description": i.get("description")}
            for shop in dev.get("shopInventories", [])
            for i in shop["items"]
        ],
    }
    art_prompts = [
        {"entityId": a["entityId"], "prompt": a["sourceDetail"]}
        for a in manifest["assets"]["assets"]
    ]

    cases = [
        (f"{city}:brief", LLMTestCase(input=golden["brief"], actual_output=dump(story_view)), brief_adherence),
        (f"{city}:talk-quests", LLMTestCase(input=story["lore"], actual_output=dump(talk_quests)), lore_teaching_quests),
        (
            f"{city}:coherence",
            LLMTestCase(
                input=golden["brief"],
                actual_output=dump({**story_view, "quests": story["quests"]}),
            ),
            narrative_coherence,
        ),
        (
            f"{city}:language",
            LLMTestCase(
                input=golden["brief"],
                actual_output=dump({"lore": story["lore"], "quests": story["quests"], **player_facing_items}),
            ),
            language_consistency,
        ),
        (
            f"{city}:art",
            LLMTestCase(
                input=dump({"lore": story["lore"], "atmosphereKeywords": story["atmosphereKeywords"]}),
                actual_output=dump(art_prompts),
            ),
            art_prompt_actionability,
        ),
    ]

    skip = golden.get("skip", {})
    return [c for c in cases if c[0].split(":", 1)[1] not in skip]


CASES = [case for golden in GOLDENS for case in build_cases(golden)]
