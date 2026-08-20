type InsightTranslator = (key: string, values?: Record<string, any>) => string;

type InsightGroup = { label: string; percent: number };

/** Fase 6/A06-R9+A08-R8: one-sentence "what explains {yVar}" summary, shared between Executive
 * Summary and Analysis so both read the same way. `groups` must already be sorted by magnitude
 * and exclude baseline/non-actionable rows. `t` must come from a namespace exposing `insight.*`
 * keys shaped like `executiveSummary`'s (see lib/i18n/messages/{es,en}.json). */
export function buildContributionInsight(
  groups: InsightGroup[],
  yVarLabel: string,
  t: InsightTranslator,
  pctLabel: (value: number | null | undefined) => string
): string | null {
  if (groups.length >= 2) {
    return t("insight.double", {
      group: groups[0].label,
      percent: pctLabel(groups[0].percent),
      group2: groups[1].label,
      percent2: pctLabel(groups[1].percent),
      yVar: yVarLabel,
    });
  }
  if (groups.length === 1) {
    return t("insight.single", {
      group: groups[0].label,
      percent: pctLabel(groups[0].percent),
      yVar: yVarLabel,
    });
  }
  return null;
}
