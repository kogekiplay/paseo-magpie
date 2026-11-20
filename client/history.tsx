import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
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
      ttft: "First token", duration: "Total time", speed: "TPS", tokens: "{{n}} tokens/s",
      reload: "Refresh", previous: "Previous", next: "Next", retry: "Retry",
      empty: "No gateway requests in this period.",
      forbidden: "The configured Magpie gateway did not grant access to request history.",
      unsupported: "This Magpie gateway does not expose request history.",
      unavailable: "Could not load Magpie request history.",
      unknownProvider: "Unknown provider", unknownModel: "Unknown model",
      failed: "Failed", canceled: "Canceled",
      page: "{{from}}–{{to}} of {{total}}",
      metricHint: "First token is the wait before output begins. ≥ marks a speed lower bound.",
    },
    "zh-CN": {
      title: "Magpie 请求历史", sidebar: "Magpie 用量", today: "今天", "7d": "近 7 天", "30d": "近 30 天",
      ttft: "首字", duration: "总耗时", speed: "TPS", tokens: "{{n}} token/秒",
      reload: "刷新", previous: "上一页", next: "下一页", retry: "重试",
      empty: "这段时间没有网关请求。",
      forbidden: "当前 Magpie 网关未授予读取请求历史的权限。",
      unsupported: "当前 Magpie 网关没有提供请求历史接口。",
      unavailable: "无法读取 Magpie 请求历史。",
      unknownProvider: "未知供应商", unknownModel: "未知模型",
      failed: "失败", canceled: "已取消",
      page: "{{from}}–{{to}} / {{total}}",
      metricHint: "首字是等到开始输出的时间，≥ 表示生成速度的下界。",
    },
  },
});

const agentLabels = { codex: "Codex", claude: "Claude Code" };
const screenId = "request-history";
type Theme = PluginScreenProps["theme"];

function formatTime(ms: number | undefined) {
  if (ms === undefined) return "—";
  return ms < 1_000 ? `${ms} ms` : `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

function Control({ label, onPress, theme, selected, disabled, icon }: {
  label: string; onPress: () => void; theme: Theme; selected?: boolean; disabled?: boolean; icon?: "RefreshCw";
}) {
  const colors = theme.colors;
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 40, minWidth: 40, alignItems: "center", justifyContent: "center", paddingHorizontal: 12,
        borderRadius: 8, opacity: disabled ? 0.45 : 1,
        backgroundColor: selected ? colors.surface2 : pressed ? colors.surface1 : colors.surface0,
      })}
    >
      {icon ? <Icon icon={icon} color={colors.foreground} size={16} />
        : <Text style={{ color: selected ? colors.foreground : colors.foregroundMuted, fontSize: 13, fontWeight: selected ? "600" : "400" }}>{label}</Text>}
    </Pressable>
  );
}

function RequestRow({ row, theme }: { row: HistoryRow; theme: Theme }) {
  const { t } = useTranslation(messages);
  const colors = theme.colors;
  const status = [row.outcome === "completed" ? undefined : t(row.outcome), row.status && `HTTP ${row.status}`]
    .filter(Boolean).join(" · ");
  const speed = row.speed ? `${row.speed.lowerBound ? "≥" : ""}${t("tokens", { n: Math.round(row.speed.tps) })}` : "—";

  return (
    <View style={{ paddingVertical: 12, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: 12, rowGap: 3 }}>
        <Text selectable style={{ color: colors.foreground, flexGrow: 1, flexShrink: 1, fontSize: 14, fontWeight: "600" }}>
          {row.provider || t("unknownProvider")} · {row.model || t("unknownModel")}
        </Text>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
          {new Date(row.time).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          {status ? ` · ${status}` : ""}
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        {[[t("ttft"), formatTime(row.ttftMs)], [t("duration"), formatTime(row.durationMs)], [t("speed"), speed]].map(([label, value]) => (
          <View key={label} style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{label}</Text>
            <Text selectable style={{ color: value === "—" ? colors.foregroundMuted : colors.foreground, fontSize: 14, fontVariant: ["tabular-nums"] }}>{value}</Text>
          </View>
        ))}
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
  const padding = layout.compact ? 14 : 24;
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface0, paddingHorizontal: padding, paddingTop: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4, paddingBottom: 6 }}>
        {historyAgents.map((value) => (
          <Control key={value} label={agentLabels[value]} theme={theme} selected={agent === value}
            onPress={() => { setAgent(value); setOffset(0); }} />
        ))}
        <View style={{ flex: 1 }} />
        <Control label={t("reload")} theme={theme} icon="RefreshCw" onPress={refresh} />
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
        {historyPeriods.map((value) => (
          <Control key={value} label={t(value)} theme={theme} selected={period === value}
            onPress={() => { setPeriod(value); setOffset(0); }} />
        ))}
      </View>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12, paddingVertical: 8 }}>{t("metricHint")}</Text>
      {page ? (
        <>
          <FlatList key={key} data={page.rows} renderItem={({ item }) => <RequestRow row={item} theme={theme} />}
            keyExtractor={(item, index) => `${item.time}:${index}`}
            ListEmptyComponent={<Text style={{ color: colors.foregroundMuted, paddingVertical: 24 }}>{t("empty")}</Text>} />
          {page.total > historyPageSize || offset > 0 ? (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 4 }}>
              <Control label={t("previous")} theme={theme} disabled={!offset} onPress={() => setOffset(Math.max(0, offset - historyPageSize))} />
              <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
                {t("page", { from: Math.min(page.offset + 1, page.total), to: Math.min(page.offset + historyPageSize, page.total), total: page.total })}
              </Text>
              <Control label={t("next")} theme={theme} disabled={page.offset + historyPageSize >= page.total} onPress={() => setOffset(page.offset + historyPageSize)} />
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
