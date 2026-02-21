#!/usr/bin/env python3
"""
Helper loader for the local Beowulf SDK without requiring installation.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BEOWULF_SRC = ROOT / "sdks" / "python" / "beowulf" / "src"
if str(BEOWULF_SRC) not in sys.path:
    sys.path.insert(0, str(BEOWULF_SRC))

from beowulf import Beowulf, BeowulfAPIError, BeowulfConfigurationError  # noqa: E402

__all__ = ["Beowulf", "BeowulfAPIError", "BeowulfConfigurationError"]
