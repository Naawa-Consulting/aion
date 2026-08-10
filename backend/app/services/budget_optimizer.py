"""Steady-state budget allocation across media channels.

Given a fixed total budget, suggests how much to spend per channel to maximize projected
revenue (or contribution, when the economic layer isn't configured). "Steady-state" means a
single constant spend level per channel is optimized (not a per-period plan) — the adstock
carryover is resolved by simulating many periods of constant spend and reading the value it
converges to, reusing the exact same adstock/Hill functions used everywhere else in the app so
behavior stays consistent with model fitting and Predict projections.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np
from scipy.optimize import minimize

from .media_transform import adstock_geometric, hill_saturation

STEADY_STATE_PERIODS = 500


def steady_state_hill(spend: float, decay: float, hill_k: float, hill_s: float) -> float:
    """Hill-transformed value once adstock carryover has converged under constant spend."""
    x = np.full(STEADY_STATE_PERIODS, max(spend, 0.0), dtype=float)
    adstocked = adstock_geometric(x, decay, normalize=True)
    return float(hill_saturation(adstocked, hill_k, hill_s)[-1])


@dataclass
class OptimizableChannel:
    channel_id: str
    name: str
    proxy_variable: str
    coef: float
    decay: float
    hill_k: float
    hill_s: float
    dollar_rate: float = 1.0
    """Dollars per unit of `proxy_variable` (see services/economics.py::resolve_channel_dollar_rate).
    Spend is optimized in dollars (what a budget means to the user) but Hill/adstock were fit on
    the model variable's own units, so `spend_dollars / dollar_rate` converts back before applying
    the curve."""
    conversion_rate: Optional[float] = None
    avg_value: Optional[float] = None

    def value_per_unit_contribution(self) -> float:
        """Revenue per unit of contribution, or 1.0 (optimize on contribution) when the
        economic layer isn't configured for this dataset."""
        if self.conversion_rate is None or self.avg_value is None:
            return 1.0
        return self.conversion_rate * self.avg_value


def _objective_value(channel: OptimizableChannel, spend_dollars: float) -> float:
    units = spend_dollars / channel.dollar_rate
    h = steady_state_hill(units, channel.decay, channel.hill_k, channel.hill_s)
    contribution = channel.coef * h
    return contribution * channel.value_per_unit_contribution()


def optimize_budget(channels: list[OptimizableChannel], budget: float) -> dict:
    """Allocates `budget` across `channels` to maximize total projected value (revenue if the
    economic layer is configured, contribution otherwise). Returns per-channel allocations plus
    projected totals — see routers/economics.py for the response shape."""
    n = len(channels)
    if n == 0 or budget <= 0:
        return {
            "allocations": [
                {
                    "channel_id": c.channel_id,
                    "name": c.name,
                    "proxy_variable": c.proxy_variable,
                    "suggested_spend": 0.0,
                    "projected_contribution": 0.0,
                    "projected_revenue": 0.0 if c.conversion_rate is not None else None,
                }
                for c in channels
            ],
            "total_projected_contribution": 0.0,
            "total_projected_revenue": 0.0 if channels and channels[0].conversion_rate is not None else None,
        }

    def total_value(spend_vec: np.ndarray) -> float:
        return sum(_objective_value(c, x) for c, x in zip(channels, spend_vec))

    coef_weights = np.array([max(c.coef, 0.0) for c in channels], dtype=float)
    saturation_weights = np.array([max(c.coef, 0.0) * c.hill_s for c in channels], dtype=float)

    def _weighted_seed(weights: np.ndarray) -> np.ndarray:
        total_weight = weights.sum()
        if total_weight <= 0:
            return np.full(n, budget / n)
        return budget * weights / total_weight

    seeds = [
        np.full(n, budget / n),
        _weighted_seed(coef_weights),
        _weighted_seed(saturation_weights),
    ]

    bounds = [(0.0, budget)] * n
    constraints = [{"type": "eq", "fun": lambda v: float(np.sum(v) - budget)}]

    best_spend = seeds[0]
    best_value = total_value(best_spend)
    for seed in seeds:
        result = minimize(
            lambda v: -total_value(v),
            seed,
            method="SLSQP",
            bounds=bounds,
            constraints=constraints,
        )
        if result.success:
            value = total_value(result.x)
            if value > best_value:
                best_value = value
                best_spend = result.x

    allocations = []
    total_contribution = 0.0
    total_revenue: Optional[float] = 0.0
    for channel, spend in zip(channels, best_spend):
        spend = max(float(spend), 0.0)
        h = steady_state_hill(spend / channel.dollar_rate, channel.decay, channel.hill_k, channel.hill_s)
        contribution = channel.coef * h
        total_contribution += contribution
        if channel.conversion_rate is not None and channel.avg_value is not None:
            revenue = contribution * channel.conversion_rate * channel.avg_value
            total_revenue = (total_revenue or 0.0) + revenue
        else:
            revenue = None
            total_revenue = None
        allocations.append(
            {
                "channel_id": channel.channel_id,
                "name": channel.name,
                "proxy_variable": channel.proxy_variable,
                "suggested_spend": spend,
                "projected_contribution": contribution,
                "projected_revenue": revenue,
            }
        )

    return {
        "allocations": allocations,
        "total_projected_contribution": total_contribution,
        "total_projected_revenue": total_revenue,
    }
