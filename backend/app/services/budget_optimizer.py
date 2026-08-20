"""Steady-state budget allocation across media channels.

Given a fixed total budget, suggests how much to spend per channel to maximize projected
revenue (or contribution, when the economic layer isn't configured). "Steady-state" means a
single constant spend level per channel is optimized (not a per-period plan) — the adstock
carryover is resolved by simulating many periods of constant spend and reading the value it
converges to, reusing the exact same adstock/Hill functions used everywhere else in the app so
behavior stays consistent with model fitting and Predict projections.

Fase 5/P5 (D2): three objectives instead of one —
  "max_revenue": maximize total value with spend summing to EXACTLY `budget` (original v1
      behavior, unchanged). Budget here is an equality constraint, not a ceiling.
  "max_roi": maximize marginal return per dollar with spend summing to AT MOST `budget` — a
      greedy allocator that keeps handing the next dollar to whichever channel currently has the
      best marginal ROI, stopping once no channel clears `marginal_roi_threshold` or the budget
      runs out. Deliberately not a single SLSQP call: "aggregate ROI" is a ratio of sums, not a
      smooth scalar objective, and the stopping rule ("marginal ROI below a threshold") is
      inherently a greedy/marginal allocation, not a continuous optimization target.
  "min_spend": minimize total spend subject to reaching `target_revenue` — a real constrained
      optimization (SLSQP, inequality constraint), since both the objective and the feasible set
      here ARE smooth.
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
    historical_max_spend: Optional[float] = None
    """Fase 5/A09-R6: max observed historical spend in $ (raw unit max × dollar_rate). None when
    it can't be computed (e.g. all-zero/missing history) — treated as "no cap" rather than a
    fabricated zero, which would wrongly forbid any spend at all on a channel with thin history."""

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


def _empty_result(channels: list[OptimizableChannel]) -> dict:
    return {
        "allocations": [
            {
                "channel_id": c.channel_id,
                "name": c.name,
                "proxy_variable": c.proxy_variable,
                "suggested_spend": 0.0,
                "dollar_rate": c.dollar_rate,
                "projected_contribution": 0.0,
                "projected_revenue": 0.0 if c.conversion_rate is not None else None,
                "historical_max_spend": c.historical_max_spend,
                "out_of_historical_range": False,
                "low_marginal_return": False,
            }
            for c in channels
        ],
        "total_projected_contribution": 0.0,
        "total_projected_revenue": 0.0 if channels and channels[0].conversion_rate is not None else None,
    }


def _finalize_allocations(channels: list[OptimizableChannel], spend: list[float]) -> dict:
    """Shared tail for every objective: compute contribution/revenue per channel from a final
    spend vector, plus the two Fase 5 business-rule flags (A09-R6 out-of-range badge, A09-R8
    zero-allocation explanation) — neither changes the optimization itself, both are read-only
    annotations on the result."""
    any_positive_spend = any(s > 1e-6 for s in spend)
    allocations = []
    total_contribution = 0.0
    total_revenue: Optional[float] = 0.0
    for channel, raw_spend in zip(channels, spend):
        s = max(float(raw_spend), 0.0)
        h = steady_state_hill(s / channel.dollar_rate, channel.decay, channel.hill_k, channel.hill_s)
        contribution = channel.coef * h
        total_contribution += contribution
        if channel.conversion_rate is not None and channel.avg_value is not None:
            revenue = contribution * channel.conversion_rate * channel.avg_value
            total_revenue = (total_revenue or 0.0) + revenue
        else:
            revenue = None
            total_revenue = None
        out_of_range = channel.historical_max_spend is not None and s > channel.historical_max_spend * 1.0001
        # A09-R8: only flag "low marginal return" for a channel that got essentially nothing
        # while at least one other channel DID receive spend — a $0 result when every channel is
        # $0 (e.g. budget=0) isn't a competitive signal, it's just an empty budget.
        low_marginal = s <= 1e-6 and any_positive_spend
        allocations.append(
            {
                "channel_id": channel.channel_id,
                "name": channel.name,
                "proxy_variable": channel.proxy_variable,
                "suggested_spend": s,
                "dollar_rate": channel.dollar_rate,
                "projected_contribution": contribution,
                "projected_revenue": revenue,
                "historical_max_spend": channel.historical_max_spend,
                "out_of_historical_range": out_of_range,
                "low_marginal_return": low_marginal,
            }
        )
    return {
        "allocations": allocations,
        "total_projected_contribution": total_contribution,
        "total_projected_revenue": total_revenue,
    }


def _weighted_seed(weights: np.ndarray, total: float, n: int) -> np.ndarray:
    weight_sum = weights.sum()
    if weight_sum <= 0:
        return np.full(n, total / n)
    return total * weights / weight_sum


def _optimize_max_revenue(channels: list[OptimizableChannel], budget: float) -> list[float]:
    """Original v1 objective, unchanged: maximize total value with spend summing to EXACTLY
    `budget` (equality constraint) — 3 seeded SLSQP runs, keep the best, then a defensive
    clip+rescale since SLSQP only satisfies bounds/equality up to its own tolerance."""
    n = len(channels)

    def total_value(spend_vec) -> float:
        return sum(_objective_value(c, x) for c, x in zip(channels, spend_vec))

    coef_weights = np.array([max(c.coef, 0.0) for c in channels], dtype=float)
    saturation_weights = np.array([max(c.coef, 0.0) * c.hill_s for c in channels], dtype=float)

    seeds = [
        np.full(n, budget / n),
        _weighted_seed(coef_weights, budget, n),
        _weighted_seed(saturation_weights, budget, n),
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

    # Defensive invariant: SLSQP's box bounds/equality constraint are satisfied only up to its
    # internal tolerance, and on some (rare, not reliably reproducible) parameter combinations the
    # returned solution has been observed to grossly violate them. Clip to the bounds actually
    # passed to the solver, then rescale proportionally so allocations always sum to exactly
    # `budget` — a budget allocation that doesn't add up to the requested budget is never a valid
    # answer regardless of what the optimizer internally reports.
    clipped = [min(max(float(s), 0.0), budget) for s in best_spend]
    clipped_total = sum(clipped)
    if clipped_total > 0:
        return [s * budget / clipped_total for s in clipped]
    return [budget / n] * n


def _optimize_max_roi(channels: list[OptimizableChannel], budget: float, marginal_roi_threshold: float) -> list[float]:
    """Greedy marginal allocation: repeatedly hand a small increment to whichever channel has the
    best marginal ROI right now, stop once nothing clears `marginal_roi_threshold` (0 = "stop once
    the next dollar no longer pays for itself") or the budget runs out. Spend sums to AT MOST
    `budget` — unlike max_revenue this never force-spends the whole budget if returns dry up early."""
    n = len(channels)
    caps = [c.historical_max_spend if c.historical_max_spend and c.historical_max_spend > 0 else budget for c in channels]
    spend = [0.0] * n
    remaining = budget
    step = max(budget / 200.0, 1.0)
    max_iterations = 4000

    for _ in range(max_iterations):
        if remaining <= 1e-9:
            break
        best_idx = None
        best_marginal_roi = None
        for i, channel in enumerate(channels):
            room = min(step, remaining, caps[i] - spend[i])
            if room <= 1e-9:
                continue
            marginal_value = _objective_value(channel, spend[i] + room) - _objective_value(channel, spend[i])
            marginal_roi = (marginal_value - room) / room
            if marginal_roi < marginal_roi_threshold:
                continue
            if best_marginal_roi is None or marginal_roi > best_marginal_roi:
                best_marginal_roi = marginal_roi
                best_idx = i
        if best_idx is None:
            break
        room = min(step, remaining, caps[best_idx] - spend[best_idx])
        spend[best_idx] += room
        remaining -= room

    return spend


def _optimize_min_spend(channels: list[OptimizableChannel], target_revenue: float, budget_cap: float) -> list[float]:
    """Minimize total spend subject to `total_value(spend) >= target_revenue`. `budget_cap` (the
    request's `budget` field, repurposed here) is used only as a per-channel upper bound when a
    channel has no usable historical max — this objective has no fixed budget of its own."""
    n = len(channels)
    caps = [c.historical_max_spend if c.historical_max_spend and c.historical_max_spend > 0 else budget_cap for c in channels]
    bounds = [(0.0, cap) for cap in caps]

    def total_value(spend_vec) -> float:
        return sum(_objective_value(c, x) for c, x in zip(channels, spend_vec))

    constraints = [{"type": "ineq", "fun": lambda v: total_value(v) - target_revenue}]

    coef_weights = np.array([max(c.coef, 0.0) for c in channels], dtype=float)
    seed_total = min(sum(caps), max(budget_cap, 1.0))
    seed = _weighted_seed(coef_weights, seed_total, n) if coef_weights.sum() > 0 else np.full(n, seed_total / n)
    seed = np.minimum(seed, caps)

    result = minimize(
        lambda v: float(np.sum(v)),
        seed,
        method="SLSQP",
        bounds=bounds,
        constraints=constraints,
    )
    if result.success and total_value(result.x) >= target_revenue - 1e-6:
        return [max(float(s), 0.0) for s in result.x]
    # Infeasible even at full caps (the target simply isn't reachable within the channels' own
    # historical range) — spend at caps for the best achievable value rather than return a
    # solution that silently understates what's needed; the caller sees the shortfall via
    # `total_projected_revenue` < target_revenue.
    return list(caps)


def optimize_budget(
    channels: list[OptimizableChannel],
    budget: float,
    *,
    objective: str = "max_revenue",
    marginal_roi_threshold: float | None = None,
    target_revenue: float | None = None,
) -> dict:
    """Allocates spend across `channels` per `objective` (see module docstring) — returns
    per-channel allocations plus projected totals, see routers/economics.py for the response
    shape. `channels=[]` or `budget<=0` (for the two budget-driven objectives) short-circuits to
    an all-zero result without touching scipy."""
    if not channels:
        return _empty_result(channels)

    if objective == "max_roi":
        spend = _optimize_max_roi(channels, max(budget, 0.0), marginal_roi_threshold or 0.0) if budget > 0 else [0.0] * len(channels)
        return _finalize_allocations(channels, spend)

    if objective == "min_spend":
        if target_revenue is None or target_revenue <= 0:
            return _empty_result(channels)
        spend = _optimize_min_spend(channels, target_revenue, max(budget, 1.0))
        return _finalize_allocations(channels, spend)

    # default: max_revenue
    if budget <= 0:
        return _empty_result(channels)
    spend = _optimize_max_revenue(channels, budget)
    return _finalize_allocations(channels, spend)
