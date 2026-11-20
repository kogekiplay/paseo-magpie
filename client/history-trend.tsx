import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View, type TextStyle } from "react-native";
import { defineTranslations, useRpc, useTranslation, type PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/ui";
import { getTrend, type HistoryInput, type TrendOutput } from "../shared/history.ts";

const messages = defineTranslations({ resources: {
  en: {
    title: "Performance trend", p90: "First token P90", tpsP50: "Median TPS", seconds: "s", tokens: "tok/s",
    provider: "Provider", choose: "Choose provider", loading: "Loading trend…", unavailable: "Could not load the trend.",
    empty: "No samples for this metric.", samples: "{{count}} samples", requests: "{{count}} requests",
    explore: "View samples for {{time}}", open: "View {{provider}} requests for {{time}}",
    highlight: "Highlight {{provider}}", single: "1 interval", noSamples: "No samples",
  },
  "zh-CN": {
    title: "性能趋势", p90: "首字 P90", tpsP50: "TPS 中位数", seconds: "秒", tokens: "token/秒",
    provider: "供应商", choose: "选择供应商", loading: "正在读取趋势…", unavailable: "无法读取性能趋势。",
    empty: "当前指标没有样本。", samples: "{{count}} 个样本", requests: "{{count}} 条请求",
    explore: "查看 {{time}} 的样本", open: "查看 {{provider}} 在 {{time}} 的请求",
    highlight: "突出显示 {{provider}}", single: "1 个时段", noSamples: "无样本",
  },
} });

const metrics = ["p90", "tpsP50"] as const;
const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const numeric: TextStyle = { fontVariant: ["tabular-nums"] };
type Metric = (typeof metrics)[number];
type Theme = PluginScreenProps["theme"];
type Ready = Extract<TrendOutput, { state: "ready" }>;
type Provider = Omit<Ready["providers"][number], "points"> & {
  color: string;
  sampleBuckets: number;
  points: Map<number, Ready["providers"][number]["points"][number]>;
};
export type TrendSelection = { id: string; provider: string; bucket: number; timeLabel: string; snapshot: string };

const palettes = {
  light: ["#9236b8", "#215fd0", "#af4b0b", "#007c70", "#bb3069", "#577300", "#a02d27", "#00769e", "#6546b8", "#896400"],
  dark: ["#d490f6", "#83adff", "#ffa96a", "#47d9be", "#ff8db6", "#bddb62", "#ff9386", "#67caef", "#b49fff", "#eacc68"],
};

export function trendColors(surface: string, providers: readonly { id: string }[]): ReadonlyMap<string, string> {
  const hex = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(surface);
  const brightness = hex && (0.2126 * parseInt(hex[1], 16) + 0.7152 * parseInt(hex[2], 16) + 0.0722 * parseInt(hex[3], 16));
  const palette = brightness !== null && brightness < 128 ? palettes.dark : palettes.light;
  return new Map(providers.map(({ id }) => id).sort().map((id, i) => [id, palette[i % palette.length]]));
}

function Chart({ theme, compact, data, providers, metric, spotlight, selected, select, tickLabel, intervalLabel }: {
  theme: Theme; compact: boolean; data: Ready; providers: Provider[]; metric: Metric;
  spotlight?: string;
  selected?: number; select: (start: number) => void;
  tickLabel: (start: number) => string; intervalLabel: (bucket: Ready["buckets"][number]) => string;
}) {
  const { t } = useTranslation(messages);
  const { colors } = theme;
  const [width, setWidth] = useState(0);
  const [highlight, setHighlight] = useState<number>();
  const height = compact ? 106 : 144;
  const divisor = metric === "p90" ? 1000 : 1;
  const buckets = data.buckets;
  let max = 0;
  for (const provider of providers) {
    for (const point of provider.points.values()) max = Math.max(max, point[metric]?.value ?? 0);
  }
  if (!max) return <Text style={{ color: colors.foregroundMuted, paddingVertical: 24 }}>{t("empty")}</Text>;
  const interval = max / divisor / 3;
  const power = 10 ** Math.floor(Math.log10(interval));
  const step = (interval <= power ? 1 : interval <= 2 * power ? 2 : interval <= 5 * power ? 5 : 10) * power;
  const slotWidth = width / buckets.length;
  const x = (index: number) => slotWidth * (index + 0.5);
  const y = (value: number) => height * (1 - value / divisor / (3 * step));
  const ticks = [3, 2, 1, 0];
  const tickCount = Math.min(buckets.length, compact ? 3 : 7);
  const labels = Array.from({ length: tickCount }, (_, i) => tickCount === 1 ? 0 : Math.round(i * (buckets.length - 1) / (tickCount - 1)));
  const labelWidth = Math.min(compact ? 55 : 70, width / Math.max(labels.length, 1));
  const caption = { color: colors.foregroundMuted, fontSize: 11 };
  return (
    <View style={{ gap: 4 }}>
      <Text style={caption}>{t(metric === "p90" ? "seconds" : "tokens")}</Text>
      <View style={{ flexDirection: "row", gap: 7, paddingTop: 6 }}>
        <View style={{ width: 35, height }} aria-hidden>
          {ticks.map((i) => <Text key={i} numberOfLines={1} style={[caption, numeric, {
            position: "absolute", right: 0, top: height * (1 - i / 3) - 7,
          }]}>{numberFormat.format(i * step)}</Text>)}
        </View>
        <View style={{ flex: 1, minWidth: 0 }} onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}>
          <View style={{ height }}>
            <View pointerEvents="none" aria-hidden style={{ position: "absolute", inset: 0 }}>
              {ticks.map((i) => <View key={i} style={{ position: "absolute", left: 0, right: 0,
                top: height * (1 - i / 3), height: 1, backgroundColor: colors.border }} />)}
              {width > 0 && providers.map((provider) => (
                <View key={provider.id} style={{ position: "absolute", inset: 0,
                  opacity: spotlight && spotlight !== provider.id ? 0.2 : 1,
                  zIndex: spotlight === provider.id ? 2 : provider.sampleBuckets === 1 ? 1 : 0 }}>
                  {buckets.map((bucket, i) => {
                    const value = provider.points.get(bucket.start)?.[metric]?.value;
                    if (value === undefined) return null;
                    const previous = buckets[i - 1];
                    const lastValue = previous?.end === bucket.start ? provider.points.get(previous.start)?.[metric]?.value : undefined;
                    const top = y(value);
                    const left = x(i);
                    const dx = slotWidth;
                    const dy = lastValue === undefined ? 0 : top - y(lastValue);
                    const distance = Math.hypot(dx, dy);
                    const isolated = provider.sampleBuckets === 1;
                    const radius = isolated ? 7 : bucket.start === selected || buckets.length <= 8 ? 4 : 2.5;
                    return (
                      <View key={bucket.start} style={{ position: "absolute", inset: 0 }}>
                        {lastValue !== undefined ? <View style={{ position: "absolute",
                          width: distance, height: 2, left: left - (dx + distance) / 2, top: top - dy / 2 - 1,
                          backgroundColor: provider.color, transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
                        }} /> : null}
                        <View style={{ position: "absolute", left: left - radius, top: top - radius,
                          width: radius * 2, height: radius * 2, borderRadius: radius,
                          borderWidth: isolated ? 2 : 0, borderColor: provider.color,
                          backgroundColor: isolated ? "transparent" : provider.color }} />
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
            <View style={{ flexDirection: "row", height }}>
              {buckets.map((bucket) => {
                const active = bucket.start === selected;
                const values = providers.flatMap((provider) => {
                  const point = provider.points.get(bucket.start)?.[metric];
                  return point ? [`${provider.name}, ${numberFormat.format(point.value / divisor)}, ${t("samples", { count: point.count })}`] : [];
                });
                return (
                  <Pressable key={bucket.start} accessibilityRole="button" accessibilityLabel={t("explore", { time: intervalLabel(bucket) })}
                    accessibilityHint={values.join(". ")} accessibilityState={{ selected: active }}
                    onFocus={() => setHighlight(bucket.start)} onBlur={() => setHighlight(undefined)}
                    onHoverIn={() => setHighlight(bucket.start)} onHoverOut={() => setHighlight(undefined)}
                    onPress={() => select(bucket.start)} style={{ flex: 1, alignItems: "center" }}>
                    {active || highlight === bucket.start ? <View style={{ width: 1, height,
                      backgroundColor: colors.foregroundMuted, opacity: active ? 0.5 : 0.28 }} /> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
          <View aria-hidden style={{ height: 22, marginTop: 6 }}>
            {width > 0 && labels.map((i) => <Text key={i} numberOfLines={1} style={[caption, numeric, {
              position: "absolute", width: labelWidth, textAlign: "center", left: Math.max(0, Math.min(width - labelWidth, x(i) - labelWidth / 2)),
            }]}>{tickLabel(buckets[i].start)}</Text>)}
          </View>
        </View>
      </View>
    </View>
  );
}

export function PerformanceTrend({ theme, compact, model, period, providerColors, showRequests }: {
  theme: Theme; compact: boolean; model: string; period: HistoryInput["period"];
  providerColors: ReadonlyMap<string, string>;
  showRequests: (selection: TrendSelection) => void;
}) {
  const { t, locale } = useTranslation(messages);
  const readTrend = useRpc(getTrend);
  const [data, setData] = useState<TrendOutput>();
  const [metric, setMetric] = useState<Metric>("p90");
  const [providerId, setProviderId] = useState<string>();
  const [spotlight, setSpotlight] = useState<string>();
  const [choosing, setChoosing] = useState(false);
  const [selected, setSelected] = useState<number>();
  useEffect(() => {
    let current = true;
    const settle = (result: TrendOutput) => { if (current) setData(result); };
    void readTrend({ model, period }).then(settle, () => settle({ state: "unavailable" }));
    return () => { current = false; };
  }, [readTrend, model, period]);

  const { colors } = theme;
  const ready = data?.state === "ready" ? data : undefined;
  const providers = useMemo(() => (ready?.providers ?? []).map(({ points, ...provider }) => ({
    ...provider, color: providerColors.get(provider.id) ?? colors.accent,
    sampleBuckets: points.filter((point) => point[metric]).length,
    points: new Map(points.map((point) => [point.start, point])),
  })), [ready, providerColors, colors.accent, metric]);
  const active = providers.find(({ id }) => id === providerId)
    ?? providers.find(({ sampleBuckets }) => sampleBuckets) ?? providers[0];
  const visible = compact && active ? [active] : providers;
  const hourly = period === "today";
  const timeZone = ready?.timeZone;
  const day = useMemo(() => new Intl.DateTimeFormat(locale, { timeZone, month: "short", day: "numeric" }), [locale, timeZone]);
  const clock = useMemo(() => new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }), [locale, timeZone]);
  const describe = (bucket: Ready["buckets"][number]) => hourly
    ? `${day.format(bucket.start)} ${clock.format(bucket.start)}–${clock.format(bucket.end)}` : day.format(bucket.start);
  const bucket = ready?.buckets.find(({ start }) => start === selected);
  const caption = { color: colors.foregroundMuted, fontSize: 12 };
  const dot = (provider: Provider) => <View aria-hidden style={{ width: 8, height: 8, borderRadius: 4,
    borderWidth: 1.5, borderColor: provider.color, backgroundColor: provider.sampleBuckets === 1 ? "transparent" : provider.color }} />;
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border, padding: compact ? 11 : 14, gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <Text accessibilityRole="header" style={{ flexShrink: 1, fontSize: 14, fontWeight: "600", color: colors.foreground }}>{t("title")}</Text>
        <View accessibilityRole="tablist" style={{ flexDirection: "row", flexShrink: 1, padding: 2, gap: 2, borderRadius: 8,
          borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 }}>
          {metrics.map((key) => <Pressable key={key} accessibilityRole="tab" accessibilityLabel={t(key)} aria-selected={key === metric}
            hitSlop={{ top: 5, bottom: 5, left: 0, right: 0 }} onPress={() => setMetric(key)}
            style={({ pressed }) => ({ minHeight: 32, paddingHorizontal: compact ? 6 : 9, flexShrink: 1, justifyContent: "center", borderRadius: 6,
              backgroundColor: key === metric ? colors.accent : pressed ? colors.surface2 : "transparent" })}>
            <Text numberOfLines={1} style={{ color: key === metric ? colors.accentForeground : colors.foregroundMuted,
              fontWeight: key === metric ? "600" : "500", fontSize: 12 }}>{t(key)}</Text>
          </Pressable>)}
        </View>
      </View>
      {compact && active && providers.length > 1 ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t("choose")} aria-expanded={choosing} onPress={() => setChoosing(true)}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 8,
            minHeight: 36, borderRadius: 7, backgroundColor: pressed || choosing ? colors.surface2 : colors.surface1 })}>
          <Text style={[caption, { flex: 1 }]}>{t("provider")}</Text>{dot(active)}
          <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 12, fontWeight: "600", color: active.color }}>{active.name}</Text>
          {active.sampleBuckets <= 1 ? <Text style={caption}>{t(active.sampleBuckets ? "single" : "noSamples")}</Text> : null}
          <Icon icon="ChevronDown" size={13} color={colors.foregroundMuted} />
        </Pressable>
      ) : null}
      {ready ? <Chart theme={theme} compact={compact} data={ready} providers={visible} metric={metric} selected={selected}
        spotlight={!compact && providers.some(({ id, sampleBuckets }) => id === spotlight && sampleBuckets) ? spotlight : undefined}
        select={(start) => setSelected((previous) => previous === start ? undefined : start)}
        tickLabel={(start) => hourly ? clock.format(start) : day.format(start)} intervalLabel={describe} />
        : <View style={{ minHeight: 100, justifyContent: "center", alignItems: "center", gap: 6 }}>
          {!data ? <ActivityIndicator color={colors.foregroundMuted} /> : null}
          <Text accessibilityLiveRegion="polite" style={caption}>{t(data ? "unavailable" : "loading")}</Text>
        </View>}
      {(!compact || providers.length === 1) && visible.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
          {visible.map((provider) => {
            const isSpotlit = spotlight === provider.id && provider.sampleBuckets > 0;
            const legend = (
              <>
                {dot(provider)}
                <Text style={{ ...caption, color: provider.color, fontWeight: "600" }}>{provider.name}</Text>
                {provider.sampleBuckets <= 1 ? <Text style={caption}>{t(provider.sampleBuckets ? "single" : "noSamples")}</Text> : null}
              </>
            );
            const style = { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 26,
              paddingHorizontal: 7, borderRadius: 6 } as const;
            return compact || !provider.sampleBuckets ? <View key={provider.id} style={style}>{legend}</View>
              : <Pressable key={provider.id} accessibilityRole="button" accessibilityLabel={t("highlight", { provider: provider.name })}
                aria-pressed={isSpotlit} onPress={() => setSpotlight(isSpotlit ? undefined : provider.id)}
                style={({ pressed }) => ({
                  ...style, borderWidth: 1,
                  borderColor: isSpotlit ? provider.color : colors.border,
                  backgroundColor: isSpotlit || pressed ? colors.surface1 : colors.surface0,
                })}>{legend}</Pressable>;
          })}
        </View>
      ) : null}
      {bucket && ready ? <View style={{ backgroundColor: colors.surface1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}>
        <Text accessibilityLiveRegion="polite" style={[caption, numeric, { marginVertical: 4 }]}>{describe(bucket)}</Text>
        {visible.map((provider) => {
          const point = provider.points.get(bucket.start);
          if (!point) return null;
          const sample = point[metric];
          const unit = metric === "p90" ? t("seconds") : t("tokens");
          const value = sample ? `${numberFormat.format(sample.value / (metric === "p90" ? 1000 : 1))} ${unit}` : "—";
          return <Pressable key={provider.id} accessibilityRole="button" accessibilityLabel={t("open", { provider: provider.name, time: describe(bucket) })}
            onPress={() => showRequests({
              id: provider.id, provider: provider.name, bucket: bucket.start, timeLabel: describe(bucket), snapshot: ready.snapshot,
            })}
            style={({ pressed }) => ({ minHeight: 42, flexDirection: "row", alignItems: "center", gap: 6, opacity: pressed ? 0.7 : 1 })}>
            {dot(provider)}<Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: provider.color, fontSize: 13 }}>{provider.name}</Text>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={[numeric, { fontSize: 13, fontWeight: "600", color: colors.foreground }]}>{value}</Text>
              <Text style={[numeric, caption]}>{t("samples", { count: sample?.count ?? 0 })} · {t("requests", { count: point.requests })}</Text>
            </View>
            <Icon icon="ChevronRight" size={14} color={colors.accent} />
          </Pressable>;
        })}
        {!visible.some((provider) => provider.points.has(bucket.start)) ? <Text style={caption}>{t("empty")}</Text> : null}
      </View> : null}
      {choosing ? <Modal title={t("choose")} open onOpenChange={setChoosing}>
        <Modal.Content>
          <FlatList data={providers} keyExtractor={(provider) => provider.id} style={{ maxHeight: 340 }}
            renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={item.name} accessibilityState={{ selected: item.id === active?.id }}
              onPress={() => { setProviderId(item.id); setSelected(undefined); setChoosing(false); }}
              style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 8,
                borderRadius: 6, backgroundColor: pressed || item.id === active?.id ? colors.surface2 : "transparent" })}>
              {dot(item)}<Text style={{ flex: 1, color: item.color }}>{item.name}</Text>
              {item.id === active?.id ? <Icon icon="Check" size={16} color={colors.accent} /> : null}
            </Pressable>} />
        </Modal.Content>
      </Modal> : null}
    </View>
  );
}
