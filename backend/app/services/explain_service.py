"""Service for generating guardrailed natural-language explanations of deterministic access routes."""
import json
import logging
import os
import re
from typing import Any, Dict, List, Optional, Set
import urllib.error
import urllib.request

from app.models.schemas import ExplainResponse
from app.services.access_engine import access_engine

logger = logging.getLogger("unreachable.explain")


def extract_all_numbers(data: Any) -> Set[float]:
    """Recursively extract all numeric values from a dictionary, list, or primitive.
    
    Includes numbers embedded inside string identifiers (e.g. 'bldg-201', '3.5m').
    """
    numbers: Set[float] = set()

    def _walk(obj: Any):
        if isinstance(obj, bool):
            return
        elif isinstance(obj, (int, float)):
            numbers.add(round(float(obj), 4))
        elif isinstance(obj, str):
            for match in re.findall(r"\d+(?:\.\d+)?", obj):
                try:
                    numbers.add(round(float(match), 4))
                except ValueError:
                    pass
        elif isinstance(obj, dict):
            for k, v in obj.items():
                _walk(k)
                _walk(v)
        elif isinstance(obj, (list, tuple, set)):
            for item in obj:
                _walk(item)

    _walk(data)
    return numbers


def validate_explanation(text: str, allowed_numbers: Set[float]) -> bool:
    """Validate that LLM text strictly follows rules:
    
    1. Does not claim a route is 'safe'.
    2. Contains ONLY numbers that are present in the underlying deterministic facts.
    """
    if not text or not text.strip():
        return False

    # Guardrail rule: Do not say a route is safe
    if re.search(r"\bsafe\b", text, re.IGNORECASE):
        logger.info("Guardrail rejected explanation: output claims route is 'safe'")
        return False

    # Guardrail rule: Extract all numbers; if any number is not in facts, reject
    tokens = re.findall(r"\d+(?:\.\d+)?", text)
    for tok in tokens:
        try:
            num = round(float(tok), 4)
            if num not in allowed_numbers:
                logger.info(
                    "Guardrail rejected explanation: invented number '%s' not present in facts",
                    tok,
                )
                return False
        except ValueError:
            return False

    return True


def generate_template_explanation(facts: Dict[str, Any]) -> str:
    """Deterministic fallback explanation adhering to the 3-sentence guideline."""
    classification = facts.get("classification", "unknown")
    building = facts.get("building_name") or facts.get("building_id", "the destination building")
    origin = facts.get("station_id", "station-01")
    vehicle = facts.get("vehicle_name") or facts.get("vehicle_id", "emergency vehicle")
    req_w = facts.get("required_width", 3.5)
    dist = facts.get("distance", 0)
    limiting = facts.get("limiting_road_names") or facts.get("limiting_roads") or []
    limiting_str = ", ".join(limiting) if limiting else "the access corridor"

    if classification == "feasible":
        return (
            f"The evaluated route from {origin} to {building} is feasible for the {vehicle} apparatus over {dist}m. "
            f"All traversed road corridors meet or exceed the required minimum clearance width of {req_w}m with no recorded physical obstructions. "
            "Frontage road access is verified, while final building doorway clearance remains subject to field inspection."
        )
    elif classification == "constrained":
        return (
            f"Access from {origin} to {building} is constrained along {limiting_str} over a {dist}m route. "
            f"Available carriageway width is narrow relative to the required {req_w}m clearance for {vehicle}. "
            "Passage is possible with reduced operating margins and caution."
        )
    elif classification == "infeasible":
        return (
            f"Access from {origin} to {building} is infeasible for the {vehicle} apparatus requiring {req_w}m width. "
            f"Traversal is blocked or physical clearance is insufficient along {limiting_str}. "
            "An alternative route or smaller vehicle profile is required."
        )
    else:  # unknown
        return (
            f"Access from {origin} to {building} cannot be verified due to unmeasured road segments. "
            f"Compliance with the required {req_w}m clearance for {vehicle} cannot be confirmed from existing cadastre evidence. "
            "On-ground survey is required before emergency routing can be assured."
        )


class ExplainService:
    """Manages deterministic fact extraction, local LLM querying, and guardrail enforcement."""

    def build_facts(
        self,
        station_id: str,
        building_id: str,
        vehicle_id: str,
    ) -> Dict[str, Any]:
        """Extract deterministic facts from route calculation and building assessment."""
        assessment = access_engine.assess_building_access(
            building_id=building_id,
            vehicle_id=vehicle_id,
            origin_station_id=station_id,
        )

        limiting_road_names: List[str] = []
        widths: Dict[str, float] = {}
        dist: float = 0.0

        if assessment.route:
            dist = round(assessment.route.total_distance_m, 1)
            limiting_ids = set(assessment.route.limiting_segments)
            for seg in assessment.route.segment_assessments:
                if seg.width_m is not None:
                    widths[seg.name] = round(float(seg.width_m), 1)
                if seg.road_id in limiting_ids or seg.status != "feasible":
                    if seg.name not in limiting_road_names:
                        limiting_road_names.append(seg.name)

        if not limiting_road_names and assessment.limitations:
            limiting_road_names = list(assessment.limitations)

        req_width = (
            assessment.vehicle.min_clearance_width_m
            if assessment.vehicle.min_clearance_width_m is not None
            else assessment.vehicle.minClearanceWidthM or 3.5
        )

        return {
            "classification": assessment.classification,
            "building_id": assessment.building_id,
            "building_name": assessment.building_name,
            "station_id": assessment.origin_station_id,
            "vehicle_id": vehicle_id,
            "vehicle_name": assessment.vehicle.name,
            "required_width": req_width,
            "distance": dist,
            "limiting_road_names": limiting_road_names,
            "widths": widths,
            "evidence_status": assessment.entrance_status,
        }

    def query_gemini_api(
        self,
        facts: Dict[str, Any],
        timeout_sec: float = 7.0,
    ) -> Optional[str]:
        """Attempt to call Google Gemini API for fast, real-time explanation."""
        api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if not api_key:
            return None

        model_name = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"

        system_instruction = (
            "You are an emergency routing expert. Explain in exactly 2 or 3 short factual sentences using ONLY the facts provided. "
            "Do NOT invent numbers, measurements, or speculative claims. Never say a route is completely safe. "
            "Refer strictly to the provided corridor clearances and access criteria."
        )
        user_prompt = f"Facts:\n{json.dumps(facts, indent=2)}\n\nExplain the route assessment:"

        payload = {
            "system_instruction": {
                "parts": [{"text": system_instruction}]
            },
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": user_prompt}]
                }
            ],
            "generationConfig": {
                "temperature": 0.0,
                "maxOutputTokens": 200,
            }
        }

        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                candidates = data.get("candidates", [])
                if candidates and "content" in candidates[0]:
                    parts = candidates[0]["content"].get("parts", [])
                    if parts and "text" in parts[0]:
                        return parts[0]["text"].strip()
        except Exception as exc:
            logger.info("Gemini API call failed (%s); trying fallback", exc)
            return None

        return None

    def query_local_llm(
        self,
        facts: Dict[str, Any],
        timeout_sec: float = 180.0,
    ) -> Optional[str]:
        """Attempt to call local OpenAI-compatible endpoint (LM Studio).
        
        Uses stdlib urllib. Never makes cloud calls. Timeout default 180s (3 min).
        """
        base_url = os.getenv("LM_STUDIO_URL", "http://127.0.0.1:1234/v1").rstrip("/")
        env_model = os.getenv("LM_MODEL", "").strip()

        # Query /models to find the best available model on the endpoint
        resolved_model = env_model
        try:
            models_req = urllib.request.Request(
                f"{base_url}/models",
                headers={
                    "Accept": "application/json",
                    "User-Agent": "UNREACHABLE-Engine/1.0",
                    "ngrok-skip-browser-warning": "true",
                },
                method="GET",
            )
            with urllib.request.urlopen(models_req, timeout=4.0) as resp:
                models_data = json.loads(resp.read().decode("utf-8"))
                data_items = models_data.get("data", [])
                if data_items and isinstance(data_items, list):
                    all_ids = [m.get("id", "") for m in data_items if m.get("id")]
                    # Match env_model substring (e.g. 'gemma-4' matching 'google/gemma-4-e4b')
                    matched = None
                    if env_model:
                        for mid in all_ids:
                            if env_model.lower() in mid.lower():
                                matched = mid
                                break
                    if matched:
                        resolved_model = matched
                    elif all_ids:
                        # Default to the first generative text model available
                        text_models = [m for m in all_ids if "embedding" not in m.lower()]
                        resolved_model = text_models[0] if text_models else all_ids[0]
        except Exception as exc:
            logger.info("Could not fetch /models from %s: %s; using %s", base_url, exc, resolved_model or "default")

        if not resolved_model:
            resolved_model = "default"

        system_prompt = (
            "Explain in 3 short sentences using ONLY the facts provided. "
            "Do not add numbers or claims. Do not say a route is safe."
        )
        user_prompt = f"Facts:\n{json.dumps(facts, indent=2)}\n\nExplain the route assessment:"

        payload = {
            "model": resolved_model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.0,
            "max_tokens": 180,
        }

        req = urllib.request.Request(
            f"{base_url}/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "User-Agent": "UNREACHABLE-Engine/1.0",
                "ngrok-skip-browser-warning": "true",
            },
            method="POST",
        )

        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            choices = data.get("choices", [])
            if choices and "message" in choices[0]:
                content = choices[0]["message"].get("content", "")
                return content.strip()

        return None

    def explain(
        self,
        station_id: str,
        building_id: str,
        vehicle_id: str = "fire",
    ) -> ExplainResponse:
        """Generates a strictly validated explanation from deterministic facts using Local LLM (LM Studio Gemma)."""
        facts = self.build_facts(
            station_id=station_id,
            building_id=building_id,
            vehicle_id=vehicle_id,
        )
        allowed_numbers = extract_all_numbers(facts)

        # 1. Primary: Local LLM (LM Studio with Gemma or any loaded local model)
        try:
            logger.info("Attempting local LLM query via LM Studio for %s (timeout: 180s)...", building_id)
            llm_text = self.query_local_llm(facts, timeout_sec=180.0)
            logger.info("Local LLM response received: %s", llm_text)
            if llm_text:
                if validate_explanation(llm_text, allowed_numbers):
                    return ExplainResponse(
                        text=llm_text,
                        source="local_llm",
                        validated=True,
                    )
                else:
                    logger.warning("Local LLM output failed guardrail validation (text: %r); allowed numbers: %s; falling back to template", llm_text, allowed_numbers)
        except Exception as exc:
            logger.warning("Local LLM call error (%s); falling back to template", exc, exc_info=True)

        # 2. Deterministic template fallback
        template_text = generate_template_explanation(facts)
        return ExplainResponse(
            text=template_text,
            source="template",
            validated=True,
        )


explain_service = ExplainService()


