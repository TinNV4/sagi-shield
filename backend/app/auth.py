"""Firebase-authenticated principals (the verifier itself arrives in a later task)."""
from __future__ import annotations
from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class Principal:
    uid: str
    role: Literal["device", "guardian", "admin"]   # anonymous -> device; google.com / phone -> guardian; claim admin=True -> admin
    name: str = ""                                  # token `name` claim, <= 40, may be empty
