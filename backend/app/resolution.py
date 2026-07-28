"""Map image size ↔ resolution tiers and Real-ESRGAN outscale."""

from __future__ import annotations

from fastapi import HTTPException

from .config import MAX_OUTSCALE, RESOLUTION_TIERS


def short_side(width: int, height: int) -> int:
    return min(width, height)


def tier_for_short_side(short: int) -> int:
    """Largest tier the image already meets (0 if below 240p)."""
    current = 0
    for tier in RESOLUTION_TIERS:
        if short >= tier:
            current = tier
        else:
            break
    return current


def compute_outscale(width: int, height: int, target_p: int) -> tuple[float, int, int]:
    """
    Return (outscale, current_tier, short).

    Raises HTTPException if target is invalid or not reachable within MAX_OUTSCALE.
    """
    if target_p not in RESOLUTION_TIERS:
        raise HTTPException(
            status_code=400,
            detail=f"target_p must be one of: {', '.join(str(t) for t in RESOLUTION_TIERS)}.",
        )

    short = short_side(width, height)
    current = tier_for_short_side(short)

    if target_p <= current:
        label = f"{current}p" if current else "current size"
        raise HTTPException(
            status_code=400,
            detail=f"Target must be higher than the image's current resolution ({label}).",
        )

    outscale = target_p / short
    if outscale <= 1:
        raise HTTPException(
            status_code=400,
            detail="Target resolution is not larger than the image.",
        )
    if outscale > MAX_OUTSCALE + 1e-6:
        max_reach = int(short * MAX_OUTSCALE)
        raise HTTPException(
            status_code=400,
            detail=(
                f"Target {target_p}p needs ~{outscale:.2f}× upscale, but max is "
                f"{MAX_OUTSCALE:g}× (about {max_reach}p for this image). "
                "Pick a lower resolution."
            ),
        )

    return outscale, current, short
