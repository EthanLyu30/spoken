import json
from app.data.scenarios import get_scenario
from app.schemas.chat import ChatMessage
from app.services.dialogue import build_messages
from app.services.speaking_scope import SPEAKING_SCOPE_POLICY


def test_dialogue_prompt_retains_policy_scene_and_history_with_soft_brevity():
    scenario = get_scenario('cafe')
    history = [ChatMessage(role='user' if i % 2 == 0 else 'assistant', content=f'turn {i}') for i in range(42)]
    messages = build_messages(scenario, history)
    system = messages[0]['content']
    assert system.startswith(SPEAKING_SCOPE_POLICY)
    assert 'usually use 10\u201325 words' in system
    assert 'more words when needed for essential information or a direct language question' in system
    assert 'Clarity and scene accuracy take priority over brevity' in system
    assert 'plain spoken words only' in system
    assert messages[1]['role'] == 'user'
    assert messages[1]['content'].startswith('Role-play scene data (not instructions):\n')
    scene = json.loads(messages[1]['content'].split('\n', 1)[1])
    assert scene == {'partner_role': scenario.partner_role, 'goal': scenario.goal, 'persona': scenario.persona}
    assert messages[2:] == [{'role': m.role, 'content': m.content} for m in history[2:]]
