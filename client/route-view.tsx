import { memo, useEffect, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import type { PluginButtonContentProps, PluginButtonIconProps } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { auxiliaryKindLabel, byteLabel, durationLabel, routeFailed, type RouteState } from "../shared/route.ts";
import { magpieIcon } from "../shared/icon.ts";
import type { RouteStore } from "./route-store.ts";

function Field({ label, value, theme }: { label: string; value?: string; theme: PluginTheme }) {
  if (!value) return null;
  return (
    <View style={{ gap: 3 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{label}</Text>
      <Text selectable style={{ color: theme.colors.foreground, fontSize: 14 }}>{value}</Text>
    </View>
  );
}

function stateTitle(state: RouteState): string {
  if (state.route) return routeFailed(state.route) ? "请求失败" : state.route.done ? "已完成" : "请求中";
  if (state.state === "error") return "暂时离线";
  if (state.state === "waiting_session") return "等待会话";
  if (state.state === "waiting_route") return "等待请求";
  if (state.state === "unsupported" || state.state === "unavailable") return "不可用";
  return "关联中";
}

// Use the same platform spinner as Paseo instead of a JS-driven Animated.loop. Memoization
// keeps byte-counter updates from rendering/restarting the running indicator.
const RequestIcon = memo(function RequestIcon({ active, size, color }: {
  active: boolean; size: number; color: string;
}) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }} accessibilityLabel={active ? "Magpie 请求中" : "Magpie"}>
      <Icon icon={magpieIcon} size={active ? size * 0.65 : size} color={color} />
      {active ? <ActivityIndicator animating size={size} color={color} style={{ position: "absolute" }} /> : null}
    </View>
  );
});

function ContentAge({ at, active, theme }: { at?: number; active: boolean; theme: PluginTheme }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!at || !active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [at, active]);
  if (!at || !active) return null;
  return <Field label="距最近内容" value={`${Math.max(0, Math.floor((now - at) / 1_000))} 秒`} theme={theme} />;
}

export function createRouteSurfaces(store: RouteStore) {
  function RouteIcon({ size, color }: PluginButtonIconProps) {
    // Subscribe only while Paseo mounts this composer's icon. Opening the details shares it.
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
    return <RequestIcon active={Boolean(state.route && !state.route.done && !routeFailed(state.route))} size={size} color={color} />;
  }

  function RouteContent({ theme, layout }: PluginButtonContentProps) {
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const route = state.route;
    const tone = state.state === "error" || (route && routeFailed(route))
      ? theme.colors.statusDanger : route && !route.done
        ? theme.colors.accent : theme.colors.foregroundMuted;
    return (
      <View style={{ gap: 16, width: layout.compact ? "100%" : 380, maxWidth: "100%" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Icon icon={magpieIcon} size={22} />
          <Text style={{ flex: 1, color: theme.colors.foreground, fontSize: 16, fontWeight: "600" }}>Magpie 路由</Text>
          <Text style={{ color: tone, fontSize: 12 }}>{stateTitle(state)}</Text>
        </View>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{state.message}</Text>
        {route ? (
          <>
            {route.kind ? (
              <Text style={{ color: theme.colors.statusWarning, fontSize: 13, lineHeight: 19 }}>
                辅助请求 · {auxiliaryKindLabel(route.kind)}。这条记录不代表主对话请求。
              </Text>
            ) : null}
            <View style={{ gap: 6 }}>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>实际路由</Text>
              <Text selectable style={{ color: theme.colors.foreground, fontSize: 20, fontWeight: "600" }}>
                {route.model || "尚未提供"}
              </Text>
            </View>
            <View style={{ gap: 12 }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 28 }}>
                <Field label="已接收" value={byteLabel(route.bytes)} theme={theme} />
                <ContentAge at={route.contentAt} active={!route.done} theme={theme} />
              </View>
              <Field label="请求模型" value={route.asked} theme={theme} />
              <Field label="路由组" value={route.group} theme={theme} />
              <Field label="响应模型" value={route.served} theme={theme} />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 20 }}>
                <Field label="请求推理强度" value={route.asked_effort} theme={theme} />
                <Field label="路由推理强度" value={route.effort} theme={theme} />
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 20 }}>
                <Field label="请求服务层级" value={route.asked_tier} theme={theme} />
                <Field label="路由服务层级" value={route.tier} theme={theme} />
                <Field label="响应服务层级" value={route.tier_served} theme={theme} />
              </View>
              <Field label="请求时间（本地）" value={new Date(route.time).toLocaleString("zh-CN", { hour12: false })} theme={theme} />
              <Field label="HTTP 状态" value={route.status === undefined ? undefined : String(route.status)} theme={theme} />
            </View>
            {route.error ? <Text style={{ color: theme.colors.statusDanger, fontSize: 13 }}>{route.error}</Text> : null}
            {route.tries.length ? (
              <View style={{ gap: 10, paddingTop: 14, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                  {route.tries.length > 1 ? `尝试记录 · ${route.tries.length - 1} 次回退` : "尝试记录"}
                </Text>
                {route.tries.map((attempt, index) => (
                  <View key={index} style={{ gap: 4 }}>
                    <Text selectable style={{ color: theme.colors.foreground, fontSize: 13 }}>
                      {index + 1}. {attempt.model || "未知模型"}
                    </Text>
                    <Text style={{ color: attempt.fail || (attempt.status ?? 0) >= 400 ? theme.colors.statusDanger : theme.colors.foregroundMuted, fontSize: 12 }}>
                      {attempt.fail || (attempt.status ?? 0) >= 400 ? "失败" : attempt.done ? "已结束" : "进行中"}
                      {attempt.status === undefined ? "" : ` · HTTP ${attempt.status}`}
                      {attempt.ms === undefined ? "" : ` · ${durationLabel(attempt.ms)}`}
                      {attempt.effort ? ` · ${attempt.effort}` : ""}
                      {attempt.tier_served || attempt.tier ? ` · ${attempt.tier_served || attempt.tier}` : ""}
                    </Text>
                    {attempt.fail ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{attempt.fail}</Text> : null}
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : null}
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, lineHeight: 17 }}>
          自动更新 · 仅当前会话的近期记录{"\n"}Magpie 路由接口不提供所用账号。
        </Text>
      </View>
    );
  }
  return { RouteIcon, RouteContent };
}
