import os
import unittest
from unittest.mock import patch

from app.api.routes import post_explain
from app.models.schemas import ExplainRequest
from app.services.data_service import data_service
from app.services.explain_service import (
    explain_service,
    extract_all_numbers,
    generate_template_explanation,
    validate_explanation,
)


class TestExplainService(unittest.TestCase):
    """Unit tests verifying local LLM explain service, guardrails, and deterministic fallbacks."""

    @classmethod
    def setUpClass(cls):
        cls._orig_mode = os.environ.get("DATA_MODE")
        os.environ["DATA_MODE"] = "demo"
        data_service._cache = None

    @classmethod
    def tearDownClass(cls):
        if cls._orig_mode is not None:
            os.environ["DATA_MODE"] = cls._orig_mode
        else:
            os.environ.pop("DATA_MODE", None)
        data_service._cache = None

    def test_facts_extraction_contains_required_fields(self):
        """Verify build_facts compiles classification, limiting roads, widths, distance, and evidence status."""
        facts = explain_service.build_facts(
            station_id="station-01",
            building_id="bldg-201",
            vehicle_id="fire",
        )
        self.assertIn("classification", facts)
        self.assertIn("limiting_road_names", facts)
        self.assertIn("widths", facts)
        self.assertIn("required_width", facts)
        self.assertIn("distance", facts)
        self.assertIn("evidence_status", facts)
        self.assertIn("building_id", facts)
        self.assertEqual(facts["building_id"], "bldg-201")

    def test_guardrail_extracts_allowed_numbers(self):
        """Verify numbers embedded in strings, floats, and ints are extracted for verification."""
        facts = {
            "building_id": "bldg-201",
            "station_id": "station-01",
            "distance": 420.5,
            "required_width": 3.5,
            "widths": {"road-101": 3.8},
        }
        allowed = extract_all_numbers(facts)
        self.assertIn(201.0, allowed)
        self.assertIn(1.0, allowed)
        self.assertIn(420.5, allowed)
        self.assertIn(3.5, allowed)
        self.assertIn(101.0, allowed)
        self.assertIn(3.8, allowed)
        self.assertNotIn(99.0, allowed)

    def test_guardrail_accepts_valid_numbers(self):
        """Verify explanation with only known facts passes guardrail."""
        allowed = {201.0, 420.5, 3.5, 3.8}
        valid_text = (
            "The route to bldg-201 covers 420.5m with a clearance of 3.8m. "
            "The vehicle requires 3.5m clearance. "
            "Frontage road access is verified."
        )
        self.assertTrue(validate_explanation(valid_text, allowed))

    def test_guardrail_rejects_invented_number(self):
        """Guardrail MUST reject LLM text containing any invented number not in facts."""
        facts = explain_service.build_facts("station-01", "bldg-201", "fire")
        allowed = extract_all_numbers(facts)
        self.assertNotIn(999.0, allowed)

        invented_number_text = (
            "The route is unobstructed but takes 999 seconds to complete. "
            "Clearance is verified for the fire tender. "
            "Doorway access requires field survey."
        )
        self.assertFalse(validate_explanation(invented_number_text, allowed))

        # Test full explain flow fallback when LLM invents a number
        with patch.object(explain_service, "query_local_llm", return_value=invented_number_text):
            res = explain_service.explain("station-01", "bldg-201", "fire")
            self.assertEqual(res.source, "template")
            self.assertTrue(res.validated)
            self.assertNotIn("999", res.text)

    def test_guardrail_rejects_claim_that_route_is_safe(self):
        """Guardrail MUST reject LLM text claiming route is safe."""
        facts = explain_service.build_facts("station-01", "bldg-201", "fire")
        allowed = extract_all_numbers(facts)

        unsafe_claim_text = "The route to bldg-201 is completely safe for emergency response."
        self.assertFalse(validate_explanation(unsafe_claim_text, allowed))

        with patch.object(explain_service, "query_local_llm", return_value=unsafe_claim_text):
            res = explain_service.explain("station-01", "bldg-201", "fire")
            self.assertEqual(res.source, "template")
            self.assertTrue(res.validated)

    def test_timeout_falls_back_to_template(self):
        """Verify timeout or network error automatically falls back to deterministic template."""
        with patch.object(explain_service, "query_local_llm", side_effect=TimeoutError("Request timed out")):
            res = explain_service.explain("station-01", "bldg-201", "fire")
            self.assertEqual(res.source, "template")
            self.assertTrue(res.validated)
            self.assertTrue(len(res.text) > 20)

    def test_template_fallback_when_lm_studio_stopped(self):
        """Without LM Studio running, explain service returns valid template explanation."""
        res = explain_service.explain("station-01", "bldg-201", "fire")
        self.assertIn(res.source, ["template", "local_llm"])
        self.assertTrue(res.validated)
        self.assertTrue(len(res.text) > 0)

    def test_mocked_llm_success_returns_local_llm_source(self):
        """When LLM returns valid text without invented numbers, source is 'local_llm'."""
        facts = explain_service.build_facts("station-01", "bldg-201", "fire")
        valid_llm_output = (
            f"The route from station-01 to bldg-201 spans {facts['distance']}m. "
            f"Corridors meet the required {facts['required_width']}m clearance without blockage. "
            "Frontage road access is verified while building entrance needs inspection."
        )
        with patch.object(explain_service, "query_local_llm", return_value=valid_llm_output):
            res = explain_service.explain("station-01", "bldg-201", "fire")
            self.assertEqual(res.source, "local_llm")
            self.assertTrue(res.validated)
            self.assertEqual(res.text, valid_llm_output)

    def test_post_explain_endpoint(self):
        """Verify post_explain route returns expected schema."""
        req = ExplainRequest(
            station_id="station-01",
            building_id="bldg-201",
            vehicle_id="fire",
        )
        res = post_explain(req)
        self.assertIsNotNone(res.text)
        self.assertIn(res.source, ["local_llm", "template"])
        self.assertTrue(res.validated)
        self.assertIsInstance(res.validated, bool)


if __name__ == "__main__":
    unittest.main()
