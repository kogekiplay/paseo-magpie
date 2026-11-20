/* Hallmark · v2.0.0 · scope: app · genre: modern-minimal · theme: Paseo · signature: request ledger */
/* Hallmark · pre-emit critique: P4 H5 E4 S4 R5 V4 · weakest: E, test the same measurements in wide and compact panes */
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View, type TextStyle } from "react-native";
import {
  defineTranslations, useRpc, useTranslation, type PluginClientContext,
  type PluginScreenProps, type PluginSidebarItemProps,
} from "@getpaseo/plugin/client";
import { Icon, SidebarRow } from "@getpaseo/plugin/client/ui";
import { getHistory, historyAgents, historyPageSize, historyPeriods, type HistoryInput, type HistoryOutput, type HistoryRow } from "../shared/history.ts";
import { magpieIcon } from "../shared/icon.ts";

const messages = defineTranslations({
  resources: {
    en: {
      title: "Magpie Request History", sidebar: "Magpie Usage", today: "Today", "7d": "7 days", "30d": "30 days",
      time: "Time", route: "Model / provider", status: "Status",
      ttft: "First token", duration: "Total time", speed: "TPS",
      milliseconds: "ms", seconds: "s", tokens: "tok/s",
      reload: "Refresh", previous: "Previous", next: "Next", retry: "Retry",
      empty: "No gateway requests in this period.",
      forbidden: "The configured Magpie gateway did not grant access to request history.",
      unsupported: "This Magpie gateway does not expose request history.",
      unavailable: "Could not load Magpie request history.",
      unknownProvider: "Unknown provider", unknownModel: "Unknown model",
      failed: "Failed", canceled: "Canceled",
      page: "{{from}}–{{to}} of {{total}}",
      metricHint: "≥ Speed lower bound",
    },
    "zh-CN": {
      title: "Magpie 请求历史", sidebar: "Magpie 用量", today: "今天", "7d": "近 7 天", "30d": "近 30 天",
      time: "时间", route: "模型 / 供应商", status: "状态",
      ttft: "首字延迟", duration: "总耗时", speed: "TPS",
      milliseconds: "毫秒", seconds: "秒", tokens: "token/秒",
      reload: "刷新", previous: "上一页", next: "下一页", retry: "重试",
      empty: "这段时间没有网关请求。",
      forbidden: "当前 Magpie 网关未授予读取请求历史的权限。",
      unsupported: "当前 Magpie 网关没有提供请求历史接口。",
      unavailable: "无法读取 Magpie 请求历史。",
      unknownProvider: "未知供应商", unknownModel: "未知模型",
      failed: "失败", canceled: "已取消",
      page: "{{from}}–{{to}} / {{total}}",
      metricHint: "≥ 速度下界",
    },
  },
});

const agentLabels = { codex: "Codex", claude: "Claude Code" };
const screenId = "request-history";
type Theme = PluginScreenProps["theme"];

const table = { time: 134, route: 2.4, ttft: 1, duration: 1, speed: 1, status: 80 };
const numeric: TextStyle = { fontVariant: ["tabular-nums"] };
const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const clockFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

function Control({ label, onPress, theme, selected, disabled, icon, compact, segment }: {
  label: string; onPress: () => void; theme: Theme; selected?: boolean; disabled?: boolean;
  icon?: "RefreshCw" | "ChevronLeft" | "ChevronRight"; compact?: boolean;
  segment?: "agent" | "period";
}) {
  const colors = theme.colors;
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const primary = selected && segment === "agent";
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
      hitSlop={segment ? { top: 4, bottom: 4, left: 0, right: 0 } : 4}
      style={({ pressed }) => ({
        flex: segment && compact ? 1 : undefined,
        minHeight: compact ? 40 : 36, minWidth: compact ? 40 : 36, alignItems: "center", justifyContent: "center",
        paddingHorizontal: icon ? 0 : compact ? 6 : 12, borderRadius: 7, borderWidth: 1,
        borderColor: focused ? colors.accent : primary ? colors.foreground : selected || !segment ? colors.border : colors.surface1,
        backgroundColor: primary ? colors.foreground : selected ? colors.surface0 : pressed || (hovered && !disabled) ? colors.surface2 : colors.surface1,
        opacity: disabled ? 0.48 : pressed ? 0.8 : 1,
      })}
    >
      {icon ? <Icon icon={icon} color={colors.foreground} size={16} />
        : <Text style={{ color: primary ? colors.surface0 : selected ? colors.foreground : colors.foregroundMuted, fontSize: 13, fontWeight: selected ? "600" : "500" }}>{label}</Text>}
    </Pressable>
  );
}

function TableHeading({ theme }: { theme: Theme }) {
  const { t } = useTranslation(messages);
  const label = { color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "500" as const };
  return (
    <View style={{ flexDirection: "row", gap: 12, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: theme.colors.surface1, borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.colors.border }}>
      <Text style={[label, { width: table.time }]}>{t("time")}</Text>
      <Text style={[label, { flex: table.route }]}>{t("route")}</Text>
      {(["ttft", "duration", "speed"] as const).map((key) => (
        <Text key={key} style={[label, { flex: table[key], textAlign: "right" }]} numberOfLines={1}>{t(key)}</Text>
      ))}
      <Text style={[label, { width: table.status, textAlign: "right" }]}>{t("status")}</Text>
    </View>
  );
}

function RequestRow({ row, theme, compact }: { row: HistoryRow; theme: Theme; compact: boolean }) {
  const { t } = useTranslation(messages);
  const colors = theme.colors;
  const status = row.status ? String(row.status) : row.outcome === "completed" ? "—" : t(row.outcome);
  const statusColor = row.outcome === "failed" ? colors.statusDanger : colors.foregroundMuted;
  const date = new Date(row.time);
  const formatTime = (ms: number | undefined) => ms === undefined ? ["—"] : ms < 1_000
    ? [String(ms), t("milliseconds")] : [(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0), t("seconds")];
  const metrics = [
    [t("ttft"), ...formatTime(row.ttftMs)],
    [t("duration"), ...formatTime(row.durationMs)],
    [t("speed"), ...(row.speed ? [`${row.speed.lowerBound ? "≥" : ""}${Math.round(row.speed.tps)}`, t("tokens")] : ["—"])],
  ];
  const identity = (
    <View style={{ flex: table.route, minWidth: 0, gap: 2 }}>
      <Text selectable style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>{row.model || t("unknownModel")}</Text>
      <Text selectable style={{ color: colors.foregroundMuted, fontSize: 12 }}>{row.provider || t("unknownProvider")}</Text>
    </View>
  );
  const timing = (
    <View style={{ width: compact ? undefined : table.time, flexShrink: 0, alignItems: compact ? "flex-end" : "flex-start", gap: 2 }}>
      <Text style={[numeric, { color: colors.foreground, fontSize: 13 }]}>{clockFormat.format(date)}</Text>
      <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{dateFormat.format(date)}</Text>
    </View>
  );
  const statusText = (
    <Text aria-label={row.status ? `HTTP ${row.status}${row.outcome === "completed" ? "" : `, ${t(row.outcome)}`}` : status}
      style={[numeric, { color: statusColor, fontSize: 12, textAlign: "right", width: compact ? undefined : table.status }]}>
      {status}
    </Text>
  );
  const values = metrics.map(([label, value, unit]) => (
    <View key={label} style={{ flex: 1, minWidth: 0, alignItems: compact ? "flex-start" : "flex-end", gap: 3 }}>
      {compact ? <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{label}</Text> : null}
      <Text selectable style={[numeric, { color: value === "—" ? colors.foregroundMuted : colors.foreground, fontSize: compact ? 16 : 14, fontWeight: "500" }]}>
        {value}{unit ? <Text style={{ color: colors.foregroundMuted, fontSize: 11, fontWeight: "400" }}> {unit}</Text> : null}
      </Text>
    </View>
  ));

  if (!compact) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 14, minHeight: 54, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        {timing}{identity}{values}{statusText}
      </View>
    );
  }
  return (
    <View style={{ paddingVertical: 12, gap: 9, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        {identity}{timing}{statusText}
      </View>
      <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: colors.surface1, borderRadius: 6 }}>
        {values}
      </View>
    </View>
  );
}

function HistoryList({ theme, layout }: PluginScreenProps) {
  const { t } = useTranslation(messages);
  const readHistory = useRpc(getHistory);
  const [period, setPeriod] = useState<HistoryInput["period"]>("today");
  const [agent, setAgent] = useState<HistoryInput["agent"]>("codex");
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [paneWidth, setPaneWidth] = useState(0);
  const key = `${period}:${agent}:${offset}:${revision}`;
  const [result, setResult] = useState<{ key: string; response: HistoryOutput }>();
  const response = result?.key === key ? result.response : undefined;
  const refresh = () => { setOffset(0); setRevision((previous) => previous + 1); };

  useEffect(() => {
    let current = true;
    const settle = (response: HistoryOutput) => { if (current) setResult({ key, response }); };
    void readHistory({ period, agent, offset }).then(settle, () => settle({ state: "unavailable" }));
    return () => { current = false; };
  }, [agent, key, offset, period, readHistory]);

  const page = response?.state === "ready" ? response : undefined;
  const colors = theme.colors;
  const compact = layout.compact || paneWidth < 760;
  const padding = compact ? 14 : 24;
  const filterGroup = {
    flexDirection: "row" as const, alignItems: "center" as const, padding: 3, gap: 3,
    backgroundColor: colors.surface1, borderRadius: 11, borderWidth: 1, borderColor: colors.border,
  };
  const agents = (
    <View style={[filterGroup, compact && { flex: 1 }]}>
      {historyAgents.map((value) => (
        <Control key={value} label={agentLabels[value]} theme={theme} selected={agent === value} compact={compact} segment="agent"
          onPress={() => { setAgent(value); setOffset(0); }} />
      ))}
    </View>
  );
  const periods = (
    <View style={filterGroup}>
      {historyPeriods.map((value) => (
        <Control key={value} label={t(value)} theme={theme} selected={period === value} compact={compact} segment="period"
          onPress={() => { setPeriod(value); setOffset(0); }} />
      ))}
    </View>
  );
  const reload = <Control label={t("reload")} theme={theme} icon="RefreshCw" onPress={refresh} compact={compact} />;
  return (
    <View onLayout={({ nativeEvent }) => setPaneWidth(nativeEvent.layout.width)}
      style={{ flex: 1, width: "100%", maxWidth: 1256, alignSelf: "center", backgroundColor: colors.surface0, paddingHorizontal: padding }}>
      {compact ? (
        <View style={{ gap: 8, paddingVertical: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>{agents}{reload}</View>
          {periods}
        </View>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12 }}>
          {agents}<View style={{ flex: 1 }} />{periods}{reload}
        </View>
      )}
      {page ? (
        <>
          {!compact && page.rows.length ? <TableHeading theme={theme} /> : null}
          <FlatList style={{ flex: 1 }} key={key} data={page.rows} renderItem={({ item }) => <RequestRow row={item} theme={theme} compact={compact} />}
            keyExtractor={(item, index) => `${item.time}:${index}`}
            ListEmptyComponent={<Text style={{ color: colors.foregroundMuted, paddingVertical: 24 }}>{t("empty")}</Text>} />
          {page.rows.length || offset > 0 ? (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 8, gap: 8 }}>
              <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{t("metricHint")}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
                <Text accessibilityLiveRegion="polite" style={[numeric, { color: colors.foregroundMuted, fontSize: 12 }]}>
                  {t("page", { from: Math.min(page.offset + 1, page.total), to: Math.min(page.offset + historyPageSize, page.total), total: page.total })}
                </Text>
              <Control label={t("previous")} icon="ChevronLeft" theme={theme} compact={compact} disabled={!offset} onPress={() => setOffset(Math.max(0, offset - historyPageSize))} />
                <Control label={t("next")} icon="ChevronRight" theme={theme} compact={compact} disabled={page.offset + historyPageSize >= page.total} onPress={() => setOffset(page.offset + historyPageSize)} />
              </View>
            </View>
          ) : null}
        </>
      ) : (
        <View style={{ alignItems: "center", paddingVertical: 28, gap: 8 }}>
          {response && response.state !== "ready" ? (
            <>
              <Text style={{ color: colors.foregroundMuted }}>{t(response.state)}</Text>
              <Control label={t("retry")} theme={theme} onPress={refresh} />
            </>
          ) : <ActivityIndicator color={colors.foregroundMuted} />}
        </View>
      )}
    </View>
  );
}

function HistoryScreen(props: PluginScreenProps) {
  return <HistoryList key={props.host.id} {...props} />;
}

function HistorySidebar({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return <SidebarRow icon={magpieIcon} active={currentScreen?.screenId === screenId} onPress={() => openScreen({ screenId })} />;
}

export function contributeHistory(client: PluginClientContext) {
  const removeScreen = client.addScreen({ id: screenId, title: messages.message("title"), Component: HistoryScreen });
  const removeSidebar = client.addSidebarHeaderItem({ id: screenId, title: messages.message("sidebar"), Component: HistorySidebar });
  return () => { removeSidebar(); removeScreen(); };
}
