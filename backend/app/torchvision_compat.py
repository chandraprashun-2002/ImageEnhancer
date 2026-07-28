"""Shim for basicsr on newer torchvision (functional_tensor removed)."""

from __future__ import annotations

import sys
import types

import torchvision.transforms.functional as F


def apply() -> None:
    name = "torchvision.transforms.functional_tensor"
    if name in sys.modules:
        return
    mod = types.ModuleType(name)
    mod.rgb_to_grayscale = F.rgb_to_grayscale
    sys.modules[name] = mod


apply()
