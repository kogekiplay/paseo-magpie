import { useState } from "react";
import { Pressable, Text, View, type TextStyle } from "react-native";
import { defineTranslations, useTranslation, type PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import type { UsageOverviewData } from "../shared/history.ts";

const messages = defineTranslations({ resources: {
  en: {
    costUsd: "Total cost", requests: "Requests", tokens: "Total tokens", cacheHit: "Cache hit rate",
    hour: "Hourly", day: "Daily", show: "Show usage trend", hide: "Hide usage trend",
    read: "Cache read", write: "Cache write", input: "New input", output: "Output",
    estimate: "Magpie estimate", unpriced: "{{size}} unpriced", noCache: "No cache measurements in this range.",
    interval: "{{time}}, {{metric}}: {{value}}",
  },
  "zh-CN": {
    costUsd: "总成本", requests: "总请求数", tokens: "Token 总量", cacheHit: "缓存命中率",
    hour: "按小时", day: "按天", show: "展开用量趋势", hide: "收起用量趋势",
    read: "缓存读取", write: "缓存写入", input: "新增输入", output: "输出",
    estimate: "Magpie 估算", unpriced: "{{size}} 条未计价", noCache: "这段时间没有缓存统计。",
    interval: "{{time}}，{{metric}} {{value}}",
  },
} });

const metrics = ["costUsd", "requests", "tokens", "cacheHit"] as const;
const units = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]] as const;
const tabular: TextStyle = { fontVariant: ["tabular-nums"] };
export type UsageMetric = (typeof metrics)[number];
type Theme = PluginScreenProps["theme"];

export function UsageOverview({ data, theme, compact, metric, setMetric, expanded, setExpanded }: {
  data: UsageOverviewData; theme: Theme; compact: boolean; metric: UsageMetric;
  setMetric: (metric: UsageMetric) => void; expanded: boolean; setExpanded: (value: boolean) => void;
}) {
  const { t, locale } = useTranslation(messages);
  const { colors } = theme;
  const [selected, setSelected] = useState<string>();
  const [hovered, setHovered] = useState<string>();
  const [plotWidth, setPlotWidth] = useState(0);
  const { totals, bucket, series } = data;
  const canExpand = bucket !== undefined && series.length > 0;
  const caption = { color: colors.foregroundMuted, fontSize: 11 };
  const count = new Intl.NumberFormat(locale);
  const abbreviatedNumber = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const compactCount = (value: number) => {
    const unit = units.find(([size]) => value >= size);
    return unit ? `${abbreviatedNumber.format(value / unit[0])}${unit[1]}` : abbreviatedNumber.format(value);
  };
  const usd = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol" });
  const axisDecimals = new Intl.NumberFormat(locale, { maximumFractionDigits: 4 });
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
  const format = (key: UsageMetric, value: number | undefined, abbreviated = false) => {
    if (value === undefined) return "—";
    if (key === "costUsd") return usd.format(value);
    if (key === "cacheHit") return percent.format(value);
    return abbreviated ? compactCount(value) : count.format(value);
  };
  const date = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" });
  // The ledger returns wall-clock buckets in the gateway's offset. Preserve
  // those clock labels when the client is viewing a remote gateway.
  const label = (time: string) => bucket === "hour" ? time.slice(11, 16) : date.format(new Date(`${time.slice(0, 10)}T00:00:00Z`));
  const values = series.flatMap((point) => point[metric] === undefined ? [] : [point[metric]]);
  const max = Math.max(0, ...values);
  const low = metric === "cacheHit" && values.length ? Math.max(0, Math.min(0.9, Math.floor(Math.min(...values) * 20) / 20 - 0.05)) : 0;
  const magnitude = max > 0 ? 10 ** Math.floor(Math.log10(max)) : 1;
  const high = metric === "cacheHit" ? 1 : Math.max(magnitude, Math.ceil(max / magnitude) * magnitude);
  const plotHeight = compact ? 85 : 118;
  const ticks = [high, (high + low) / 2, low];
  const labelWidth = 56;
  const tickCount = Math.min(series.length, compact ? 4 : Math.max(2, Math.floor(plotWidth / labelWidth)));
  const labelIndices = Array.from({ length: tickCount }, (_, i) => tickCount === 1 ? 0 : Math.round(i * (series.length - 1) / (tickCount - 1)));
  const active = series.find(({ time }) => time === (hovered ?? selected));
  const graphLabel = `${t(metric)}${bucket ? ` · ${t(bucket)}` : ""}`;
  const overviewNote = metric === "costUsd"
    ? `${t("estimate")}${totals.unpriced ? ` · ${t("unpriced", { size: count.format(totals.unpriced) })}` : ""}`
    : undefined;

  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View accessibilityRole={canExpand ? "tablist" : undefined} style={{ flexDirection: "row", backgroundColor: colors.surface0 }}>
        {metrics.map((key, i) => {
          const current = canExpand && key === metric;
          const value = format(key, totals[key], key === "tokens" || (compact && key === "requests" && totals.requests >= 100_000));
          const content = <>
            <Text numberOfLines={1} style={caption}>{t(key)}</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}
              style={[tabular, { color: current ? colors.accent : colors.foreground, fontSize: compact ? 16 : 24, fontWeight: "700" }]}>{value}</Text>
          </>;
          const style = { flex: 1, minWidth: 0, minHeight: compact ? 57 : 69, justifyContent: "center", gap: 3,
            paddingHorizontal: compact ? 8 : 14, borderRightWidth: i === metrics.length - 1 ? 0 : 1,
            borderRightColor: colors.border, borderBottomWidth: canExpand ? 2 : 0,
            borderBottomColor: current ? colors.accent : "transparent", backgroundColor: current ? colors.surface1 : colors.surface0,
          } as const;
          return canExpand ? (
            <Pressable key={key} accessibilityRole="tab" accessibilityLabel={t(key)} accessibilityHint={format(key, totals[key])}
              aria-selected={current} style={style} onPress={() => { setMetric(key); setExpanded(true); }}>
              {content}
            </Pressable>
          ) : <View key={key} style={style}>{content}</View>;
        })}
      </View>
      {canExpand ? (
        <View style={{ paddingHorizontal: compact ? 10 : 14, paddingBottom: expanded ? 10 : 0,
          borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface0 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={t(expanded ? "hide" : "show")} aria-expanded={expanded}
            onPress={() => setExpanded(!expanded)} style={({ pressed }) => ({ minHeight: 35, flexDirection: "row",
              alignItems: "center", gap: 7, opacity: pressed ? 0.7 : 1 })}>
            <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 12, fontWeight: "600", flex: 1 }}>{graphLabel}</Text>
            <Icon icon={expanded ? "ChevronUp" : "ChevronDown"} color={colors.foregroundMuted} size={15} />
          </Pressable>
          {expanded && values.length > 0 ? (
            <>
              <View style={{ flexDirection: "row", gap: 5, marginTop: 4 }}>
                <View aria-hidden style={{ width: compact ? 46 : 58, height: plotHeight }}>
                  {ticks.map((tick, i) => <Text key={i} numberOfLines={1} style={[caption, tabular,
                    { position: "absolute", right: 0, top: i * plotHeight / 2 - 6 }]}>
                    {metric === "cacheHit" ? percent.format(tick)
                      : metric === "costUsd" ? `$${tick < 1 ? axisDecimals.format(tick) : compactCount(tick)}` : compactCount(tick)}
                  </Text>)}
                </View>
                <View style={{ flex: 1, minWidth: 0 }} onLayout={({ nativeEvent }) => setPlotWidth(nativeEvent.layout.width)}>
                  <View pointerEvents="none" aria-hidden style={{ position: "absolute", top: 0, left: 0, right: 0, height: plotHeight }}>
                    {ticks.map((_, i) => <View key={i} style={{ position: "absolute", top: i * plotHeight / 2,
                      left: 0, right: 0, height: 1, backgroundColor: colors.border }} />)}
                  </View>
                  <View style={{ flexDirection: "row", height: plotHeight }}>
                    {series.map((point) => {
                      const value = point[metric];
                      const chosen = point.time === active?.time;
                      const barHeight = value === undefined || value <= low ? 0 : Math.max(1, plotHeight * (value - low) / (high - low));
                      return (
                        <Pressable key={point.time} accessibilityRole="button"
                          accessibilityLabel={t("interval", { time: label(point.time), metric: t(metric), value: format(metric, value) })}
                          accessibilityState={{ selected: point.time === selected }} onFocus={() => setHovered(point.time)} onBlur={() => setHovered(undefined)}
                          onHoverIn={() => setHovered(point.time)} onHoverOut={() => setHovered(undefined)}
                          onPress={() => setSelected((previous) => previous === point.time ? undefined : point.time)}
                          style={{ flex: 1, minWidth: 0 }}>
                          <View pointerEvents="none" aria-hidden style={{ height: plotHeight, alignItems: "center", justifyContent: "flex-end",
                            backgroundColor: chosen ? colors.surface1 : "transparent" }}>
                            {barHeight > 0 ? <View style={{ width: "65%", maxWidth: 34, height: barHeight, backgroundColor: colors.accent,
                              opacity: active && !chosen ? 0.58 : 1, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} /> : null}
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                  <View pointerEvents="none" aria-hidden style={{ height: 18, marginTop: 4 }}>
                    {plotWidth > 0 && labelIndices.map((i) => {
                      const center = plotWidth * (i + 0.5) / series.length;
                      const left = Math.max(0, Math.min(plotWidth - labelWidth, center - labelWidth / 2));
                      return <Text key={i} numberOfLines={1} style={[caption, tabular,
                        { position: "absolute", left, width: labelWidth, textAlign: "center" }]}>{label(series[i].time)}</Text>;
                    })}
                  </View>
                </View>
              </View>
              <View style={{ minHeight: 24, paddingTop: 7, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                {active ? <Text accessibilityLiveRegion="polite" style={[tabular, { color: colors.foreground, fontSize: 12, fontWeight: "600" }]}>
                  {label(active.time)} · {format(metric, active[metric])}
                </Text> : null}
                {overviewNote ? <Text style={caption}>{overviewNote}</Text> : null}
                {metric === "tokens" ? ([
                  ["input", (active ?? totals).input], ["output", (active ?? totals).output],
                  ["read", (active ?? totals).cacheRead], ["write", (active ?? totals).cacheWrite],
                ] as const).map(([key, value]) => <Text key={key} style={[caption, tabular]}>{t(key)} {compactCount(value)}</Text>) : null}
              </View>
            </>
          ) : null}
          {expanded && values.length === 0 ? <Text style={[caption, { paddingVertical: 5 }]}>{t("noCache")}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}
