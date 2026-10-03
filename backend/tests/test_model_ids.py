from model_ids import DEFAULTS, model_id


def test_env_overrides_and_fallbacks(monkeypatch):
    for job in [*DEFAULTS, "GEMINI_DEEP_MODEL"]:
        monkeypatch.delenv(job, raising=False)
    assert model_id("GEMINI_VISION_MODEL") == DEFAULTS["GEMINI_VISION_MODEL"]
    monkeypatch.setenv("GEMINI_CONFIRM_MODEL", "confirm-x")
    assert model_id("GEMINI_DEEP_MODEL") == "confirm-x"  # the deep check follows the second-opinion model
    monkeypatch.setenv("GEMINI_DEEP_MODEL", " deep-y ")
    assert model_id("GEMINI_DEEP_MODEL") == "deep-y"     # a value piped from a shell may carry whitespace
    monkeypatch.setenv("GEMINI_MODEL", "")
    assert model_id("GEMINI_MODEL") == DEFAULTS["GEMINI_MODEL"]  # an empty repository variable means "use the default"
