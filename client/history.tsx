/* Hallmark · v2.0.0 · scope: app · genre: modern-minimal · theme: Paseo · signature: request ledger */
/* Hallmark · pre-emit critique: P4 H5 E4 S4 R5 V4 · weakest: E, test the same measurements in wide and compact panes */
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View, type TextStyle, type ViewStyle } from "react-native";
import {
  defineTranslations, useRpc, useTranslation, type PluginClientContext,
  type PluginScreenProps, type PluginSidebarItemProps,
} from "@getpaseo/plugin/client";
import { Icon, Modal, SidebarRow, TextInput } from "@getpaseo/plugin/client/ui";
import { getHistory, historyAgents, historyPageSizes, historyPeriods, type HistoryInput, type HistoryOutput, type HistoryPageSize, type HistoryRow } from "../shared/history.ts";
import { magpieIcon } from "../shared/icon.ts";

const messages = defineTranslations({
  resources: {
    en: {
      title: "Magpie Request History", sidebar: "Magpie Usage", today: "Today", "7d": "7 days", "30d": "30 days",
      time: "Time", agent: "Agent", requested: "Requested model", provider: "Provider / account",
      model: "Served model", input: "Input", output: "Output", cache: "Cache hit rate", cost: "Cost",
      status: "Status", session: "Source session",
      subscription: "Subscription", api: "API", credits: "credits", costHint: "Estimated cost in USD",
      untitled: "Untitled session", unmatched: "Unlinked", openSession: "Open session {{title}}",
      ttft: "First token", duration: "Total time", speed: "TPS",
      milliseconds: "ms", seconds: "s", tokens: "tok/s",
      reload: "Refresh", first: "First page", previous: "Previous", next: "Next", last: "Last page", retry: "Retry",
      empty: "No gateway requests in this period.",
      forbidden: "The configured Magpie gateway did not grant access to request history.",
      unsupported: "This Magpie gateway does not expose request history.",
      unavailable: "Could not load Magpie request history.",
      failed: "Failed", canceled: "Canceled",
      total: "{{total}} requests", pageSize: "Per page", pageSizeValue: "{{size}} per page",
      page: "Page {{page}}", currentPage: "Current page {{page}}",
      pagePosition: "{{page}} / {{last}}", pagination: "Page options",
      pageOptions: "Page {{page}} of {{last}}. Open page options",
      jumpTo: "Go to page", jumpLabel: "Go to", jumpAction: "Go", pageUnit: "",
      metricHint: "Speed lower bound",
      details: "Details", hideDetails: "Hide details",
      chooseAgent: "Choose agent", choosePeriod: "Choose date range",
      agentFilter: "Choose agent. Current: {{agent}}", periodFilter: "Choose date range. Current: {{period}}",
    },
    "zh-CN": {
      title: "Magpie 请求历史", sidebar: "Magpie 用量", today: "今天", "7d": "近 7 天", "30d": "近 30 天",
      time: "时间", agent: "Agent", requested: "请求模型", provider: "供应商 / 账号",
      model: "实际模型", input: "输入", output: "输出", cache: "缓存命中率", cost: "费用",
      status: "状态", session: "来源会话",
      subscription: "订阅账号", api: "API", credits: "积分", costHint: "估算费用（美元）",
      untitled: "未命名会话", unmatched: "未关联", openSession: "打开会话 {{title}}",
      ttft: "首字延迟", duration: "总耗时", speed: "TPS",
      milliseconds: "毫秒", seconds: "秒", tokens: "token/秒",
      reload: "刷新", first: "第一页", previous: "上一页", next: "下一页", last: "最后一页", retry: "重试",
      empty: "这段时间没有网关请求。",
      forbidden: "当前 Magpie 网关未授予读取请求历史的权限。",
      unsupported: "当前 Magpie 网关没有提供请求历史接口。",
      unavailable: "无法读取 Magpie 请求历史。",
      failed: "失败", canceled: "已取消",
      total: "共 {{total}} 条", pageSize: "每页", pageSizeValue: "每页 {{size}} 条",
      page: "第 {{page}} 页", currentPage: "当前第 {{page}} 页",
      pagePosition: "{{page}} / {{last}}", pagination: "分页选项",
      pageOptions: "第 {{page}} 页，共 {{last}} 页。打开分页选项",
      jumpTo: "跳至页码", jumpLabel: "跳至", jumpAction: "跳页", pageUnit: "页",
      metricHint: "速度下界",
      details: "详情", hideDetails: "收起",
      chooseAgent: "选择 Agent", choosePeriod: "选择日期范围",
      agentFilter: "选择 Agent，当前 {{agent}}", periodFilter: "选择日期范围，当前 {{period}}",
    },
  },
});

const agentLabels = { codex: "Codex", claude: "Claude Code" };
const screenId = "request-history";
type Theme = PluginScreenProps["theme"];

const metricColumns = ["input", "output", "cache", "cost", "ttft", "duration", "speed"] as const;
type MetricColumn = (typeof metricColumns)[number];
const tableColumns = ["time", "agent", "session", "requested", "provider", "model", ...metricColumns, "status"] as const;
type TableColumn = (typeof tableColumns)[number];
const columnSizes: Record<TableColumn, ViewStyle> = {
  time: { width: 68 }, agent: { width: 68 },
  session: { flex: 1.35 }, requested: { flex: 1.3 }, provider: { flex: 1.95 }, model: { flex: 1.2 },
  input: { width: 44 }, output: { width: 44 }, cache: { width: 75 }, cost: { width: 63 },
  ttft: { width: 62 }, duration: { width: 59 }, speed: { width: 83 }, status: { width: 40 },
};
const tableGutter = 14;
const tableRowStyle = { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: tableGutter } as const;
const toolbarHeight = 38;
const touchToolbarHeight = 44;
const toolbarRadius = 11;
const footerHeight = 34;
const footerRadius = 8;
const timingThresholds = { ttft: [5_000, 15_000], duration: [10_000, 30_000] } as const;
const numeric: TextStyle = { fontVariant: ["tabular-nums"] };
const countFormat = new Intl.NumberFormat();
const tokenFormat = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const clockFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

function Control({ label, onPress, theme, selected, disabled, icon, segment, variant, display, expanded, touch }: {
  label: string; onPress: () => void; theme: Theme; selected?: boolean; disabled?: boolean;
  icon?: string;
  segment?: "agent" | "period";
  variant?: "refresh" | "pagination" | "page" | "pageSize";
  display?: string;
  expanded?: boolean;
  touch?: boolean;
}) {
  const colors = theme.colors;
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const primary = selected && segment === "agent";
  const activePage = selected && variant === "page";
  const pagination = variant === "pagination" || variant === "page" || variant === "pageSize";
  const height = touch ? touchToolbarHeight : variant === "refresh" ? toolbarHeight
    : pagination ? footerHeight : segment ? toolbarHeight - 6 : 36;
  const radius = variant === "refresh" ? toolbarRadius : pagination ? footerRadius : toolbarRadius - 4;
  const textColor = primary ? colors.surface0 : activePage ? colors.accentForeground
    : selected || !segment ? colors.foreground : colors.foregroundMuted;
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ selected, disabled, expanded }} disabled={disabled} onPress={onPress}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
      hitSlop={segment ? { top: 4, bottom: 4, left: 0, right: 0 } : pagination ? { top: 5, bottom: 5, left: 0, right: 0 } : 4}
      style={({ pressed }) => ({
        minHeight: height, minWidth: height, alignItems: "center", justifyContent: "center",
        flexDirection: "row", gap: 6,
        paddingHorizontal: variant === "pageSize" ? 10 : icon || pagination ? 0 : 10,
        borderRadius: radius, borderWidth: 1,
        borderColor: focused || activePage ? colors.accent : primary ? colors.foreground
          : variant === "pagination" || variant === "page" ? "transparent" : selected || !segment ? colors.border : colors.surface1,
        backgroundColor: primary ? colors.foreground : activePage ? colors.accent : selected ? colors.surface0
          : pressed || (hovered && !disabled) ? colors.surface2 : pagination && variant !== "pageSize" ? "transparent" : colors.surface1,
        opacity: disabled ? 0.48 : pressed ? 0.8 : 1,
      })}
    >
      {!icon || display ? <Text style={[pagination && numeric, { color: textColor, fontSize: 13, fontWeight: selected ? "600" : "500" }]}>{display ?? label}</Text> : null}
      {icon ? <Icon icon={icon} color={textColor} size={16} /> : null}
    </Pressable>
  );
}

function TableHeading({ theme }: { theme: Theme }) {
  const { t } = useTranslation(messages);
  const label = { color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "500" as const };
  return (
    <View style={[tableRowStyle, { paddingVertical: 10, backgroundColor: theme.colors.surface1, borderTopLeftRadius: toolbarRadius - 1, borderTopRightRadius: toolbarRadius - 1, borderBottomWidth: 1, borderColor: theme.colors.border }]}>
      {tableColumns.map((column) => (
        <View key={column} style={columnStyle(column)}>
          <Text style={label} numberOfLines={2}>{t(column)}</Text>
        </View>
      ))}
    </View>
  );
}

function isMetric(column: TableColumn): column is MetricColumn {
  return metricColumns.some((metric) => metric === column);
}

function columnStyle(column: TableColumn): ViewStyle {
  const size = columnSizes[column];
  return { minWidth: 0, flexShrink: 0, ...size, alignItems: column === "status" || isMetric(column) ? "flex-end" : undefined };
}

function SourceSession({ session, theme, compact, openSession }: {
  session: HistoryRow["session"]; theme: Theme; compact: boolean; openSession?: (agentId: string) => void;
}) {
  const { t } = useTranslation(messages);
  const { colors } = theme;
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const title = session ? session.title || t("untitled") : t("unmatched");
  const textStyle = { fontSize: compact ? 13 : 12, color: session && compact ? colors.accent : session ? colors.foreground : colors.foregroundMuted };
  return (
    <View style={{ minWidth: 0 }}>
      {session && openSession ? (
        <Pressable accessibilityRole="link" accessibilityLabel={t("openSession", { title })}
          onPress={() => openSession(session.agentId)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
          hitSlop={{ top: 5, bottom: 5, left: 0, right: 0 }}
          style={({ pressed }) => ({
            minHeight: compact ? 44 : 32, alignItems: "center", flexDirection: "row", gap: 4, borderRadius: 5, borderWidth: 1,
            borderColor: focused ? colors.accent : "transparent",
            backgroundColor: pressed || hovered ? colors.surface1 : "transparent",
          })}
        >
          <Text numberOfLines={2} style={[textStyle, { flex: compact ? undefined : 1, flexShrink: 1, minWidth: 0, textDecorationLine: hovered ? "underline" : "none" }]}>{title}</Text>
          <View aria-hidden style={{ flexShrink: 0 }}>
            <Icon icon="ArrowUpRight" size={11} color={colors.accent} />
          </View>
        </Pressable>
      ) : <Text numberOfLines={2} style={textStyle}>{title}</Text>}
    </View>
  );
}

function formatCost(cost: number) {
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  if (cost === 0 || cost >= 0.001) return `$${cost.toFixed(3)}`;
  const decimals = 1 - Math.floor(Math.log10(cost));
  return `$${decimals <= 7 ? cost.toFixed(decimals) : cost.toExponential(1)}`;
}

function formatCacheHit(hit: number) {
  const percent = Number((hit * 100).toFixed(2));
  if (hit > 0 && percent === 0) return "0.01%";
  if (hit < 1 && percent === 100) return "99.99%";
  return `${percent.toFixed(2)}%`;
}

function RequestRow({ row, agent, theme, compact, dateFormat, openSession }: {
  row: HistoryRow; agent: HistoryInput["agent"]; theme: Theme; compact: boolean; dateFormat: Intl.DateTimeFormat;
  openSession?: (agentId: string) => void;
}) {
  const { t } = useTranslation(messages);
  const colors = theme.colors;
  const [expanded, setExpanded] = useState(false);
  const status = row.status ? String(row.status) : row.outcome === "completed" ? "—" : t(row.outcome);
  const statusColor = row.outcome === "failed" ? colors.statusDanger
    : row.outcome === "completed" && row.status && row.status < 400 ? colors.statusSuccess : colors.foregroundMuted;
  const date = new Date(row.time);
  const formatTime = (ms: number | undefined) => ms === undefined ? ["—"] : ms < 1_000
    ? [String(ms), t("milliseconds")] : [(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0), t("seconds")];
  function timeColor(ms: number | undefined, [fast, slow]: readonly [number, number]) {
    if (ms === undefined) return colors.foregroundMuted;
    if (ms < fast) return colors.statusSuccess;
    return ms < slow ? colors.statusWarning : colors.statusDanger;
  }
  const formatTokens = (value: number | undefined) => value === undefined ? "—" : tokenFormat.format(value);
  const credits = row.credits === undefined ? undefined : `${countFormat.format(row.credits)} ${t("credits")}`;
  const readCost = row.costUsd === undefined ? credits : formatCost(row.costUsd);
  const costLabel = row.costUsd === undefined ? credits : `${t("costHint")} ${row.costUsd}${credits ? `, ${credits}` : ""}`;
  const readings: Record<MetricColumn, { reading: string[]; color?: string; hint?: string }> = {
    input: { reading: [formatTokens(row.inputTokens)], hint: row.inputTokens === undefined ? undefined : countFormat.format(row.inputTokens) },
    output: { reading: [formatTokens(row.outputTokens)], hint: row.outputTokens === undefined ? undefined : countFormat.format(row.outputTokens) },
    cache: { reading: [row.cacheHit === undefined ? "—" : formatCacheHit(row.cacheHit)] },
    cost: { reading: [readCost ?? "—"], color: readCost ? colors.statusSuccess : undefined, hint: costLabel },
    ttft: { reading: formatTime(row.ttftMs), color: timeColor(row.ttftMs, timingThresholds.ttft) },
    duration: { reading: formatTime(row.durationMs), color: timeColor(row.durationMs, timingThresholds.duration) },
    speed: { reading: row.speed ? [`${row.speed.lowerBound ? "≥" : ""}${Math.round(row.speed.tps)}`, t("tokens")] : ["—"] },
  };
  const protocol = row.protocol;
  const protocolLabel = protocol
    ? `${protocol.client ? `${protocol.client} → ` : ""}${protocol.upstream}${protocol.websocket ? " WS" : ""}`
    : undefined;
  const provider = (
    <View style={{ gap: 2, minWidth: 0 }}>
      <Text selectable numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>{row.provider || "—"}</Text>
      {row.account ? <Text selectable numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 11 }}>{row.account}</Text> : null}
      {row.access || protocolLabel ? (
        <Text style={{ color: colors.foregroundMuted, fontSize: 10 }}>
          {row.access ? <Text style={{ fontWeight: "600" }}>{t(row.access)}</Text> : null}
          {row.access && protocolLabel ? "  " : null}
          {protocolLabel}
        </Text>
      ) : null}
    </View>
  );
  const statusText = (
    <Text aria-label={row.status ? `HTTP ${row.status}${row.outcome === "completed" ? "" : `, ${t(row.outcome)}`}` : status}
      style={[numeric, { color: statusColor, fontSize: 12, textAlign: "right" }]}>
      {status}
    </Text>
  );
  function metric(column: MetricColumn) {
    const { reading: [value, unit], color, hint } = readings[column];
    const performance = column === "ttft" || column === "duration" || column === "speed";
    const accessibilityLabel = value.startsWith("≥") ? `${t("metricHint")} ${value.slice(1)} ${unit}` : hint;
    return (
      <View key={column} style={compact ? { flex: 1, minWidth: 0, gap: 2 } : { alignItems: "flex-end" }}>
        {compact ? <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{t(column)}</Text> : null}
        <Text selectable accessibilityLabel={accessibilityLabel} numberOfLines={compact ? 2 : 1}
          style={[numeric, { color: color ?? (value === "—" ? colors.foregroundMuted : colors.foreground), fontSize: compact && performance ? 19 : 13, fontWeight: performance ? "600" : "500" }]}>
          {value}{unit ? <Text style={{ color: colors.foregroundMuted, fontSize: 10, fontWeight: "400" }}> {unit}</Text> : null}
        </Text>
        {column === "cost" && row.costUsd !== undefined && credits ? (
          <Text numberOfLines={1} style={[numeric, { color: colors.foregroundMuted, fontSize: 10 }]}>{credits}</Text>
        ) : null}
      </View>
    );
  }
  function modelName(model: string | undefined, served = false) {
    return <Text selectable numberOfLines={2} style={{
      color: model ? colors.foreground : colors.foregroundMuted, fontSize: 13, fontWeight: served ? "600" : "500",
    }}>{model || "—"}</Text>;
  }
  const source = <SourceSession session={row.session} theme={theme} compact={compact} openSession={openSession} />;

  if (!compact) {
    const cells = {
      time: <View style={{ gap: 2 }}>
        <Text style={[numeric, { color: colors.foreground, fontSize: 13 }]}>{clockFormat.format(date)}</Text>
        <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{dateFormat.format(date)}</Text>
      </View>,
      agent: <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "500" }}>{agentLabels[agent]}</Text>,
      session: source, requested: modelName(row.requestedModel), provider,
      model: modelName(row.model, true), status: statusText,
    };
    return (
      <View style={[tableRowStyle, { paddingVertical: 8, minHeight: 56, borderBottomWidth: 1, borderBottomColor: colors.border }]}>
        {tableColumns.map((column) => (
          <View key={column} style={columnStyle(column)}>
            {isMetric(column) ? metric(column) : cells[column]}
          </View>
        ))}
      </View>
    );
  }
  const meta = { color: colors.foregroundMuted, fontSize: 12 };
  return (
    <View style={{ paddingTop: 11, paddingBottom: 3, paddingHorizontal: tableGutter, gap: 5, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <Text selectable numberOfLines={2} style={{ color: colors.foreground, fontSize: 15, fontWeight: "600" }}>
            {row.model || "—"}
          </Text>
          {row.provider ? <Text selectable numberOfLines={1} style={meta}>{row.provider}</Text> : null}
        </View>
        <View style={{ alignItems: "flex-end", gap: 2 }}>
          <Text style={[numeric, { color: colors.foreground, fontSize: 12 }]}>{clockFormat.format(date)}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={meta}>{dateFormat.format(date)}</Text>{statusText}
          </View>
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 8, paddingTop: 5 }}>{metricColumns.slice(4).map(metric)}</View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>{source}</View>
        <Control label={t(expanded ? "hideDetails" : "details")} display={t(expanded ? "hideDetails" : "details")}
          icon={expanded ? "ChevronUp" : "ChevronDown"} theme={theme} variant="pagination" touch expanded={expanded}
          onPress={() => setExpanded(!expanded)} />
      </View>
      {expanded ? (
        <View style={{ gap: 10, padding: 10, marginBottom: 7, borderRadius: 7, backgroundColor: colors.surface1 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={meta}>{t("requested")}</Text>{modelName(row.requestedModel)}
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={meta}>{t("model")}</Text>{modelName(row.model, true)}
            </View>
          </View>
          <View style={{ gap: 2 }}>
            <Text style={meta}>{t("provider")}</Text>{provider}
          </View>
          <View style={{ flexDirection: "row", gap: 6 }}>{metricColumns.slice(0, 4).map(metric)}</View>
        </View>
      ) : null}
    </View>
  );
}

function pageNumbers(page: number, last: number) {
  const width = 3;
  const start = Math.max(2, Math.min(page - Math.floor(width / 2), last - width));
  const middle = Array.from({ length: Math.min(width, Math.max(last - 2, 0)) }, (_, i) => start + i);
  const pages = last > 1 ? [1, ...middle, last] : [1];
  return pages.flatMap((value, i) => value - (pages[i - 1] ?? 0) > 1
    ? [`gap-${value}`, value] : [value]);
}

function PageJump({ page, last, theme, compact, go }: {
  page: number; last: number; theme: Theme; compact?: boolean; go: (page: number) => void;
}) {
  const { t } = useTranslation(messages);
  const [draft, setDraft] = useState(String(page));
  const [focused, setFocused] = useState(false);
  const { colors } = theme;
  const submit = () => {
    const target = Math.min(last, Math.max(1, Number(draft) || page));
    setDraft(String(target));
    go(target);
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: compact ? 3 : 7 }}>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{t("jumpLabel")}</Text>
      <TextInput
        accessibilityLabel={t("jumpTo")} value={draft} inputMode="numeric" returnKeyType="go"
        selectTextOnFocus maxLength={String(last).length + 1}
        onChangeText={(value) => setDraft(value.replace(/[^0-9]/g, ""))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={submit}
        style={[numeric, {
          color: colors.foreground, width: Math.max(compact ? 44 : 48, String(last).length * 8 + 20),
          height: compact ? touchToolbarHeight : footerHeight,
          fontSize: 13, textAlign: "center", paddingVertical: 0, borderWidth: 1, borderRadius: footerRadius,
          borderColor: focused ? colors.accent : colors.border, backgroundColor: colors.surface0,
        }]}
      />
      {compact ? <Control label={t("jumpAction")} icon="ArrowRight" theme={theme} variant="pagination" touch onPress={submit} />
        : t("pageUnit") ? <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{t("pageUnit")}</Text> : null}
    </View>
  );
}

function HistoryPagination({ total, offset, limit, theme, compact, sizeOpen, setSizeOpen, changeSize, go }: {
  total: number; offset: number; limit: HistoryPageSize; theme: Theme; compact: boolean; sizeOpen: boolean;
  setSizeOpen: (open: boolean) => void; changeSize: (size: HistoryPageSize) => void; go: (page: number) => void;
}) {
  const { t } = useTranslation(messages);
  const colors = theme.colors;
  const last = Math.ceil(total / limit);
  const current = Math.min(last, Math.floor(offset / limit) + 1);
  const label = { color: colors.foregroundMuted, fontSize: 12 };
  const nav = (key: "first" | "previous" | "next" | "last", icon: string, target: number, disabled: boolean) => (
    <Control label={t(key)} icon={icon} theme={theme} variant="pagination" touch={compact}
      disabled={disabled} onPress={() => go(target)} />
  );
  const totalText = <Text accessibilityLiveRegion="polite" numberOfLines={1} style={[numeric, label]}>
    {t("total", { total: countFormat.format(total) })}
  </Text>;
  if (compact) {
    return (
      <View style={{
        flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 4, paddingHorizontal: 8,
        borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface0,
      }}>
        <View style={{ flexShrink: 1, minWidth: 0 }}>{totalText}</View>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {nav("previous", "ChevronLeft", current - 1, current === 1)}
          <Control label={t("pageOptions", { page: current, last })} display={t("pagePosition", { page: current, last })}
            icon="ChevronDown" theme={theme} variant="pageSize" touch onPress={() => setSizeOpen(true)} />
          {nav("next", "ChevronRight", current + 1, current === last)}
        </View>
        {sizeOpen ? (
          <Modal title={t("pagination")} open={sizeOpen} onOpenChange={setSizeOpen}>
            <Modal.Content>
              <View style={{ gap: 14 }}>
                <View style={{ gap: 6 }}>
                  <Text style={label}>{t("pageSize")}</Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {historyPageSizes.map((size) => (
                      <Control key={size} label={t("pageSizeValue", { size })} display={String(size)}
                        theme={theme} variant="page" selected={limit === size} touch onPress={() => changeSize(size)} />
                    ))}
                  </View>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                  <PageJump key={current} page={current} last={last} theme={theme} compact go={go} />
                  <View style={{ flexDirection: "row" }}>
                    {nav("first", "ChevronsLeft", 1, current === 1)}
                    {nav("last", "ChevronsRight", last, current === last)}
                  </View>
                </View>
              </View>
            </Modal.Content>
          </Modal>
        ) : null}
      </View>
    );
  }
  return (
    <View style={{
      flexDirection: "row", flexWrap: "wrap", alignItems: "center",
      justifyContent: "space-between", columnGap: 12, rowGap: 6, paddingVertical: 8, paddingHorizontal: tableGutter,
      borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface1,
      borderBottomLeftRadius: toolbarRadius - 1, borderBottomRightRadius: toolbarRadius - 1, zIndex: 2,
    }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {totalText}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, zIndex: 1 }}>
          <Text style={label}>{t("pageSize")}</Text>
          <View>
            <Control label={t("pageSizeValue", { size: limit })} display={String(limit)} icon="ChevronDown"
              theme={theme} variant="pageSize" expanded={sizeOpen} onPress={() => setSizeOpen(!sizeOpen)} />
            {sizeOpen ? (
              <View style={{
                position: "absolute", bottom: footerHeight + 5, left: 0, minWidth: "100%",
                borderWidth: 1, borderColor: colors.border, borderRadius: footerRadius, padding: 3,
                backgroundColor: colors.surface0, zIndex: 3,
              }}>
                {historyPageSizes.map((size) => (
                  <Control key={size} label={t("pageSizeValue", { size })} display={String(size)}
                    theme={theme} variant="page" selected={limit === size} onPress={() => changeSize(size)} />
                ))}
              </View>
            ) : null}
          </View>
        </View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3, alignSelf: "center" }}>
        {nav("first", "ChevronsLeft", 1, current === 1)}
        {nav("previous", "ChevronLeft", current - 1, current === 1)}
        {pageNumbers(current, last).map((page) => typeof page === "string"
          ? <Text key={page} style={[numeric, label, { width: 22, textAlign: "center" }]}>…</Text>
          : <Control key={page} label={t(page === current ? "currentPage" : "page", { page })} display={String(page)} selected={page === current}
              variant="page" theme={theme} onPress={() => go(page)} />)}
        {nav("next", "ChevronRight", current + 1, current === last)}
        {nav("last", "ChevronsRight", last, current === last)}
      </View>
      <PageJump key={current} page={current} last={last} theme={theme} go={go} />
    </View>
  );
}

function HistoryList({ theme, layout, navigation, host }: PluginScreenProps) {
  const { t, locale } = useTranslation(messages);
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }), [locale]);
  const readHistory = useRpc(getHistory);
  const [period, setPeriod] = useState<HistoryInput["period"]>("today");
  const [agent, setAgent] = useState<HistoryInput["agent"]>("codex");
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState<HistoryPageSize>(50);
  const [revision, setRevision] = useState(0);
  const [paneWidth, setPaneWidth] = useState(0);
  const [menu, setMenu] = useState<"agent" | "period" | "pages">();
  const sizeOpen = menu === "pages";
  const setSizeOpen = (open: boolean) => setMenu(open ? "pages" : undefined);
  const filter = `${period}:${agent}`;
  const key = `${filter}:${offset}:${limit}:${revision}`;
  const [result, setResult] = useState<{ key: string; filter: string; response: HistoryOutput }>();
  const response = result?.key === key ? result.response : undefined;
  const refresh = () => { setOffset(0); setRevision((previous) => previous + 1); setMenu(undefined); };
  const go = (page: number) => { setOffset((page - 1) * limit); setMenu(undefined); };
  const changeSize = (size: HistoryPageSize) => { setLimit(size); setOffset(0); setMenu(undefined); };
  const changeAgent = (value: HistoryInput["agent"]) => { setAgent(value); setOffset(0); setMenu(undefined); };
  const changePeriod = (value: HistoryInput["period"]) => { setPeriod(value); setOffset(0); setMenu(undefined); };
  const openSession = navigation ? (agentId: string) => navigation.openAgent({ agentId, serverId: host.id }) : undefined;

  useEffect(() => {
    let current = true;
    const settle = (response: HistoryOutput) => {
      if (!current) return;
      if (response.state === "ready") {
        const lastOffset = Math.floor(Math.max(0, response.total - 1) / limit) * limit;
        if (offset > lastOffset) { setOffset(lastOffset); return; }
      }
      setResult({ key, filter, response });
    };
    void readHistory({ period, agent, offset, limit }).then(settle, () => settle({ state: "unavailable" }));
    return () => { current = false; };
  }, [agent, filter, key, limit, offset, period, readHistory]);

  const page = response?.state === "ready" ? response : undefined;
  const total = result?.filter === filter && result.response.state === "ready" ? result.response.total : 0;
  const colors = theme.colors;
  const compact = layout.compact || paneWidth < 820;
  const compactRows = layout.compact || paneWidth < 1050;
  const padding = compact ? 12 : 16;
  const filterGroup = {
    flexDirection: "row" as const, alignItems: "center" as const, padding: 2, gap: 3,
    minHeight: toolbarHeight,
    backgroundColor: colors.surface1, borderRadius: toolbarRadius, borderWidth: 1, borderColor: colors.border,
  };
  const agents = (
    <View style={filterGroup}>
      {historyAgents.map((value) => (
        <Control key={value} label={agentLabels[value]} theme={theme} selected={agent === value} segment="agent"
          onPress={() => changeAgent(value)} />
      ))}
    </View>
  );
  const periods = (
    <View style={filterGroup}>
      {historyPeriods.map((value) => (
        <Control key={value} label={t(value)} theme={theme} selected={period === value} segment="period"
          onPress={() => changePeriod(value)} />
      ))}
    </View>
  );
  const reload = <Control label={t("reload")} theme={theme} icon="RefreshCw" onPress={refresh} variant="refresh" touch={compact} />;
  return (
    <View onLayout={({ nativeEvent }) => setPaneWidth(nativeEvent.layout.width)}
      style={{ flex: 1, width: "100%", maxWidth: 1256, alignSelf: "center", backgroundColor: colors.surface0, paddingHorizontal: padding, paddingBottom: padding }}>
      {compact ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 5 }}>
          <Control label={t("agentFilter", { agent: agentLabels[agent] })} display={agentLabels[agent]} icon="ChevronDown"
            theme={theme} variant="pageSize" touch onPress={() => setMenu("agent")} />
          <Control label={t("periodFilter", { period: t(period) })} display={t(period)} icon="ChevronDown"
            theme={theme} variant="pageSize" touch onPress={() => setMenu("period")} />
          <View style={{ flex: 1 }} />
          {reload}
        </View>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 6 }}>
          {agents}<View style={{ flex: 1 }} />{periods}{reload}
        </View>
      )}
      <View style={{ flex: 1, minHeight: 0, borderWidth: compact ? 0 : 1, borderColor: colors.border, borderRadius: compact ? 0 : toolbarRadius }}>
        {page ? (
          <FlatList style={{ flex: 1 }} key={key} data={page.rows}
            renderItem={({ item }) => <RequestRow row={item} agent={agent} theme={theme} compact={compactRows}
              dateFormat={dateFormat} openSession={openSession} />}
            keyExtractor={(item, index) => `${item.time}:${index}`}
            ListHeaderComponent={!compactRows && page.rows.length > 0 ? <TableHeading theme={theme} /> : undefined}
            stickyHeaderIndices={!compactRows && page.rows.length > 0 ? [0] : undefined}
            ListEmptyComponent={<Text style={{ color: colors.foregroundMuted, padding: tableGutter }}>{t("empty")}</Text>} />
        ) : (
          <View style={{ flex: 1, alignItems: "center", paddingVertical: 28, gap: 8 }}>
            {response && response.state !== "ready" ? (
              <>
                <Text style={{ color: colors.foregroundMuted }}>{t(response.state)}</Text>
                <Control label={t("retry")} theme={theme} onPress={refresh} />
              </>
            ) : <ActivityIndicator color={colors.foregroundMuted} />}
          </View>
        )}
        {sizeOpen && !compact ? <Pressable accessible={false} tabIndex={-1} onPress={() => setSizeOpen(false)}
          style={{ position: "absolute", inset: 0, zIndex: 1 }} /> : null}
        {total > 0 ? <HistoryPagination total={total} offset={offset} limit={limit} theme={theme} compact={compact}
          sizeOpen={sizeOpen} setSizeOpen={setSizeOpen} changeSize={changeSize} go={go} /> : null}
      </View>
      {compact && (menu === "agent" || menu === "period") ? (
        <Modal title={t(menu === "agent" ? "chooseAgent" : "choosePeriod")} open
          onOpenChange={(open) => { if (!open) setMenu(undefined); }}>
          <Modal.Content>
            <View style={{ gap: 6 }}>
              {menu === "agent"
                ? historyAgents.map((value) => (
                  <Control key={value} label={agentLabels[value]} theme={theme} selected={agent === value} segment="agent" touch
                    onPress={() => changeAgent(value)} />
                ))
                : historyPeriods.map((value) => (
                  <Control key={value} label={t(value)} theme={theme} selected={period === value} segment="period" touch
                    onPress={() => changePeriod(value)} />
                ))}
            </View>
          </Modal.Content>
        </Modal>
      ) : null}
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
