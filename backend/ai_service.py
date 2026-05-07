"""AI service: motion form analysis & training plan generation via GPT-5.2."""
import json
import logging
import os
import re
import uuid
from typing import Any

from emergentintegrations.llm.chat import LlmChat, UserMessage

logger = logging.getLogger(__name__)

EMERGENT_LLM_KEY = os.environ["EMERGENT_LLM_KEY"]
MODEL_PROVIDER = "openai"
MODEL_NAME = "gpt-5.2"

SPORT_CONTEXT = {
    "basketball": {
        "key_metrics": "shooting elbow alignment, knee bend depth, follow-through, jump symmetry, balance",
        "elite_benchmark": "Stephen Curry / Klay Thompson shooting form: 90° elbow, snap wrist, 45-55° launch angle.",
    },
    "soccer": {
        "key_metrics": "kick plant foot stability, hip rotation, ankle lock, knee drive, balance leg",
        "elite_benchmark": "Cristiano Ronaldo / Megan Rapinoe striking form: full hip rotation, locked ankle, planted foot 6-8 inches beside ball.",
    },
    "swimming": {
        "key_metrics": "stroke symmetry, hip rotation, arm catch angle, kick rhythm, head position",
        "elite_benchmark": "Katie Ledecky / Caeleb Dressel freestyle: high elbow catch, 45° body roll, 6-beat kick.",
    },
    "pickleball": {
        "key_metrics": "paddle face, shoulder turn, knee bend, weight transfer, split step timing",
        "elite_benchmark": "Ben Johns / Anna Leigh Waters mechanics: continental grip, compact backswing, low ready position.",
    },
}


def _new_chat(system: str) -> LlmChat:
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=str(uuid.uuid4()),
        system_message=system,
    )
    chat.with_model(MODEL_PROVIDER, MODEL_NAME)
    return chat


def _parse_json(text: str) -> dict:
    # strip code fences
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        text = match.group(0)
    return json.loads(text)


async def analyze_form(sport: str, pose_summary: dict[str, Any]) -> dict:
    """Analyze pose data summary and return form analysis JSON."""
    ctx = SPORT_CONTEXT.get(sport, {"key_metrics": "general athletic form", "elite_benchmark": "general elite athlete form"})
    system = (
        "You are an elite biomechanics coach and motion-capture analyst. "
        "You evaluate athlete pose data and return STRICT JSON only — no markdown, no commentary."
    )
    prompt = f"""Analyze this {sport} performance using the captured pose statistics.

KEY METRICS FOR {sport.upper()}: {ctx['key_metrics']}
ELITE BENCHMARK: {ctx['elite_benchmark']}

POSE DATA SUMMARY (from MediaPipe / motion capture):
{json.dumps(pose_summary, indent=2)}

Return ONLY this JSON shape (no extra text):
{{
  "form_score": <integer 0-100>,
  "summary": "<2-3 sentence overall assessment>",
  "strengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
  "improvements": [
    {{"area": "<biomechanical area>", "issue": "<what's off>", "fix": "<concrete coaching cue>", "severity": "low|medium|high"}}
  ],
  "elite_comparison": "<how this compares to the benchmark in 1-2 sentences>",
  "next_focus": "<single most important thing to drill next session>"
}}"""
    chat = _new_chat(system)
    response = await chat.send_message(UserMessage(text=prompt))
    try:
        return _parse_json(response)
    except Exception as e:
        logger.exception("Failed to parse AI form analysis: %s", e)
        return {
            "form_score": 70,
            "summary": "Analysis pending detailed review.",
            "strengths": ["Consistent posture detected"],
            "improvements": [],
            "elite_comparison": "Comparable to developing athlete level.",
            "next_focus": "Continue capturing more sessions for richer analysis.",
            "_raw": response,
        }


async def generate_training_plan(sport: str, analysis: dict, athlete_level: str = "intermediate") -> dict:
    system = (
        "You are an elite sports performance coach designing personalized training programs. "
        "Return STRICT JSON only — no markdown, no commentary."
    )
    prompt = f"""Design a 7-day personalized training plan for a {athlete_level} {sport} athlete based on their form analysis.

FORM ANALYSIS:
{json.dumps(analysis, indent=2)}

Return ONLY this JSON (no extra text):
{{
  "title": "<catchy plan title>",
  "duration_days": 7,
  "focus_areas": ["<area1>", "<area2>", "<area3>"],
  "weekly_schedule": [
    {{
      "day": 1,
      "name": "<day theme>",
      "duration_min": <int>,
      "drills": [
        {{"name": "<drill name>", "sets": "<e.g. 3x10>", "purpose": "<what it fixes>", "cue": "<focus cue>"}}
      ]
    }}
  ],
  "form_cues": ["<top cue 1>", "<top cue 2>", "<top cue 3>"],
  "milestones": [
    {{"week": 2, "goal": "<measurable goal>"}},
    {{"week": 4, "goal": "<measurable goal>"}}
  ]
}}

Build all 7 days. Make drills sport-specific to {sport}."""
    chat = _new_chat(system)
    response = await chat.send_message(UserMessage(text=prompt))
    try:
        return _parse_json(response)
    except Exception as e:
        logger.exception("Failed to parse AI training plan: %s", e)
        return {
            "title": f"{sport.title()} Foundations",
            "duration_days": 7,
            "focus_areas": ["Form", "Consistency", "Power"],
            "weekly_schedule": [],
            "form_cues": ["Stay balanced", "Follow through", "Breathe"],
            "milestones": [],
            "_raw": response,
        }
