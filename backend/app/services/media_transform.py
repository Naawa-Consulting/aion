"""Pure adstock (geometric decay) + Hill saturation transforms for media variables.

Same functions are used at model-fit time and at scenario-projection time (predict.py)
so behavior is guaranteed identical end to end.
"""
from __future__ import annotations

import numpy as np


def adstock_geometric(x: np.ndarray, decay: float, normalize: bool = True) -> np.ndarray:
    """y_t = x_t + decay*y_{t-1}, normalized by (1-decay) to keep scale comparable
    across channels with different decay values."""
    x = np.asarray(x, dtype=float)
    if x.size == 0:
        return x
    out = np.empty_like(x)
    out[0] = x[0]
    for i in range(1, x.size):
        out[i] = x[i] + decay * out[i - 1]
    if normalize:
        out = out * (1.0 - decay)
    return out


def hill_saturation(x: np.ndarray, k: float, s: float) -> np.ndarray:
    """x^s / (k^s + x^s), epsilon-stabilized."""
    x = np.asarray(x, dtype=float)
    x_pos = np.clip(x, 0.0, None)
    k = max(float(k), 1e-9)
    xs = np.power(x_pos, s)
    ks = np.power(k, s)
    return xs / (ks + xs + 1e-12)


def apply_media_transform(x: np.ndarray, decay: float, k: float, s: float, lag: int = 0) -> np.ndarray:
    """lag -> adstock -> Hill pipeline. The one function used both at fit time and
    when projecting scenarios, so adstock carryover/saturation behave identically."""
    x = np.asarray(x, dtype=float)
    if lag > 0:
        if lag >= x.size:
            x = np.zeros_like(x)
        else:
            x = np.concatenate([np.zeros(lag), x[:-lag]])
    adstocked = adstock_geometric(x, decay, normalize=True)
    return hill_saturation(adstocked, k, s)


def half_life(decay: float) -> float | None:
    """Periods for the adstock effect to fall to half its initial value, for display only."""
    if decay <= 0.0 or decay >= 1.0:
        return None
    return float(np.log(0.5) / np.log(decay))
