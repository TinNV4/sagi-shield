"""Shared test environment: offline, in-memory, no rate limit (one test turns it on)."""
import os

os.environ.update(USE_LLM="0", STORE="memory", RATE_LIMIT_PER_MIN="0", VERDICT_STDOUT="0", AUTH="fake", LEGACY_FAMILY="1")
