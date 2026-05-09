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
        "key_metrics": "shooting elbow alignment, knee bend depth, follow-through, jump symmetry, balance, release angle",
        "elite_benchmark": "Stephen Curry / Klay Thompson shooting form: 90° elbow load → full extension at release, snap wrist, 45-55° launch angle.",
        "rep_unit": "shot",
    },
    "soccer": {
        "key_metrics": "kick plant foot stability, hip rotation, ankle lock, knee drive, balance leg",
        "elite_benchmark": "Cristiano Ronaldo / Megan Rapinoe striking form: full hip rotation, locked ankle, planted foot 6-8 inches beside ball, knee snap.",
        "rep_unit": "kick",
    },
    "swimming": {
        "key_metrics": "stroke symmetry, hip rotation, arm catch angle, kick rhythm, head position",
        "elite_benchmark": "Katie Ledecky / Caeleb Dressel freestyle: high-elbow catch (110-130°), 45° body roll, 6-beat kick.",
        "rep_unit": "stroke",
    },
    "pickleball": {
        "key_metrics": "paddle face, shoulder turn, knee bend, weight transfer, split step timing",
        "elite_benchmark": "Ben Johns / Anna Leigh Waters mechanics: continental grip, compact backswing, low ready position (knee 130-150°).",
        "rep_unit": "swing",
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
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        text = match.group(0)
    return json.loads(text)


def _compact_for_prompt(pose_summary: dict[str, Any]) -> dict[str, Any]:
    """Drop fields too verbose for the LLM (e.g. base64 images) but keep rich rep data."""
    out = {k: v for k, v in pose_summary.items() if k != "keyframes"}
    # cap reps to 30 so prompt stays small
    if isinstance(out.get("reps"), list) and len(out["reps"]) > 30:
        out["reps"] = out["reps"][:30] + [{"_truncated": len(pose_summary["reps"]) - 30}]
    return out


async def analyze_form(sport: str, pose_summary: dict[str, Any]) -> dict:
    """Produce a sport-specific AI biomechanics report from rep-level pose data."""
    ctx = SPORT_CONTEXT.get(sport, {"key_metrics": "general athletic form", "elite_benchmark": "general elite athletic form", "rep_unit": "rep"})
    rep_count = pose_summary.get("rep_count", 0)
    no_reps = pose_summary.get("no_reps_detected", False) or rep_count == 0
    overall = pose_summary.get("overall_score")
    consistency = pose_summary.get("consistency")
    has_rich_data = bool(pose_summary.get("reps"))

    if no_reps and not has_rich_data:
        # fallback for very short captures or detection failures
        return {
            "form_score": 60,
            "summary": (
                f"We couldn't reliably detect distinct {ctx['rep_unit']}s in this capture. "
                "Try a slightly longer take with the athlete fully in frame, side-on, and well lit."
            ),
            "strengths": ["Capture pipeline ran end-to-end."],
            "improvements": [
                {
                    "area": "Capture quality",
                    "issue": f"No clear {ctx['rep_unit']} reps detected.",
                    "fix": f"Frame the athlete head-to-toe, ensure 3-5 clean {ctx['rep_unit']}s, and record from a side-angle.",
                    "severity": "medium",
                }
            ],
            "elite_comparison": "Insufficient data for benchmark comparison.",
            "next_focus": f"Recapture with at least 3 clear {ctx['rep_unit']}s in frame.",
            "rep_callouts": [],
        }

    system = (
        "You are an elite biomechanics coach analysing motion-capture data. "
        "You return STRICT JSON only — no markdown, no commentary outside the JSON object."
    )

    # Build basketball-specific outcome-correlation block when shot data is present
    outcome_block = ""
    shot_outcomes = pose_summary.get("shot_outcomes")
    makes_vs_misses = pose_summary.get("makes_vs_misses")
    if sport == "basketball" and shot_outcomes:
        outcome_block = f"""

SHOT OUTCOMES (from ball-tracking + hoop ROI):
- Attempts: {shot_outcomes.get('attempts')}
- Makes:    {shot_outcomes.get('makes')}
- FG%:      {shot_outcomes.get('fg_pct')}%
"""
        if makes_vs_misses:
            outcome_block += "\nFORM CORRELATIONS — average measurement on MAKES vs MISSES (delta = makes_avg - misses_avg):\n"
            outcome_block += json.dumps(makes_vs_misses, indent=2)
            outcome_block += "\nIDENTIFY the 1-2 measurements with the largest absolute delta — these are the form factors most correlated with missed shots."

    prompt = f"""Analyse this {sport} performance using the per-rep kinematic data.

KEY METRICS FOR {sport.upper()}: {ctx['key_metrics']}
ELITE BENCHMARK: {ctx['elite_benchmark']}

SESSION DATA (each rep is one {ctx['rep_unit']}; angles are degrees, all measurements at the rep apex):
{json.dumps(_compact_for_prompt(pose_summary), indent=2)}{outcome_block}

Notes for your analysis:
- The local rep score (0-100) measures how each rep matched target biomechanical bands.
- Overall_score is the mean of rep scores. Consistency is 100 - 1.5×stddev of rep scores.
- Comment on the WORST rep specifically — what failed mechanically, what to drill.
- If rep_count is low (<3), note that more reps are needed for a confident assessment.{(' - When SHOT OUTCOMES is present, your "summary" MUST cite makes/attempts/FG% and your top "improvements" MUST be the form factors most correlated with misses (largest delta).') if outcome_block else ''}

Return ONLY this JSON:
{{
  "form_score": <integer 0-100, anchored to overall_score but you may adjust ±5 based on data quality and consistency>,
  "summary": "<2-3 sentence overall assessment that references rep count and consistency>",
  "strengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
  "improvements": [
    {{"area": "<biomechanical area>", "issue": "<measurable issue, cite numbers>", "fix": "<concrete coaching cue>", "severity": "low|medium|high"}}
  ],
  "elite_comparison": "<how this athlete compares to the benchmark in 1-2 sentences, cite numbers>",
  "next_focus": "<single most important thing to drill next session>",
  "rep_callouts": [
    {{"rep_index": <int>, "label": "best|worst|notable", "comment": "<one-liner why>"}}
  ]
}}"""
    chat = _new_chat(system)
    response = await chat.send_message(UserMessage(text=prompt))
    try:
        result = _parse_json(response)
    except Exception as e:
        logger.exception("Failed to parse AI form analysis: %s", e)
        result = {
            "form_score": overall if isinstance(overall, int) else 70,
            "summary": "Analysis pending detailed review.",
            "strengths": ["Consistent posture detected"],
            "improvements": [],
            "elite_comparison": "Comparable to developing athlete level.",
            "next_focus": "Continue capturing more sessions for richer analysis.",
            "rep_callouts": [],
            "_raw": response,
        }
    # Always include the deterministic rep stats so the UI doesn't depend on the LLM
    result.setdefault("rep_count", rep_count)
    result.setdefault("consistency", consistency)
    result["overall_score"] = overall
    if shot_outcomes:
        result["shot_outcomes"] = shot_outcomes
    if makes_vs_misses:
        result["makes_vs_misses"] = makes_vs_misses
    return result


async def generate_training_plan(sport: str, analysis: dict, athlete_level: str = "intermediate") -> dict:
    system = (
        "You are an elite sports performance coach designing personalized training programs. "
        "Return STRICT JSON only — no markdown, no commentary."
    )
    outcome_hint = ""
    shot_outcomes = analysis.get("shot_outcomes") if isinstance(analysis, dict) else None
    makes_vs_misses = analysis.get("makes_vs_misses") if isinstance(analysis, dict) else None
    if sport == "basketball" and shot_outcomes:
        outcome_hint = (
            f"\n\nThis athlete shot {shot_outcomes.get('makes')}/{shot_outcomes.get('attempts')}"
            f" ({shot_outcomes.get('fg_pct')}% FG)."
        )
        if makes_vs_misses:
            outcome_hint += (
                "\nMake-vs-miss form deltas (focus drills around the largest deltas):\n"
                f"{json.dumps(makes_vs_misses, indent=2)}"
            )
            outcome_hint += "\nAt least 3 of the 7 days MUST include a drill explicitly targeting the form factor with the largest delta between makes and misses."

    prompt = f"""Design a 7-day personalized training plan for a {athlete_level} {sport} athlete based on their form analysis.

FORM ANALYSIS:
{json.dumps(analysis, indent=2)}{outcome_hint}

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
