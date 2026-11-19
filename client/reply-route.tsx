import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { defineTranslations, useTranslation, type PluginClientContext, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { replyRouteKind, replyRouteSchema, type ReplyRoute, type RequestRoute } from "../shared/reply-route.ts";
import { magpieIcon } from "../shared/icon.ts";

const messages = defineTranslations({
  resources: {
    en: {
      finalRoute: "Final reply route", history: "Routes for {{total}} recorded requests", reply: "Final reply",
      tool: "Tool call", model: "Model response", attempts: "Routing attempts", failed: "Failed", completed: "Completed",
      truncated: "Showing the most recent recorded requests",
    },
    "zh-CN": {
      finalRoute: "最终回复路由", history: "本轮已记录 {{total}} 次请求", reply: "最终回复",
      tool: "工具调用", model: "模型响应", attempts: "尝试记录", failed: "失败", completed: "完成",
      truncated: "仅显示最近的请求记录",
    },
  },
});

type Theme = PluginTimelineItemProps<ReplyRoute>["theme"];

function AttemptList({ attempts, theme }: { attempts: RequestRoute["attempts"]; theme: Theme }) {
  const { t } = useTranslation(messages);
  return (
    <View style={{ gap: 4, paddingLeft: 17 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{t("attempts")}</Text>
      {attempts.map((attempt, index) => (
        <Text key={index} selectable style={{ color: theme.colors.foreground, fontSize: 12 }}>
          {index + 1}. {attempt.route} · {t(attempt.failed ? "failed" : "completed")}
          {attempt.status === undefined ? "" : ` · HTTP ${attempt.status}`}
        </Text>
      ))}
    </View>
  );
}

function RequestRow({ request, index, theme }: {
  request: NonNullable<ReplyRoute["requests"]>[number]; index: number; theme: Theme;
}) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation(messages);
  const muted = theme.colors.foregroundMuted;
  return (
    <View style={{ gap: 4 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((open) => !open)}
        style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 3 }}
      >
        <Icon icon={expanded ? "ChevronUp" : "ChevronDown"} size={12} color={muted} />
        <Text style={{ flexShrink: 1, color: muted, fontSize: 12 }}>
          {index + 1}. {t(request.phase)} · <Text style={{ color: theme.colors.foreground }}>{request.provider} · {request.model}</Text>
        </Text>
      </Pressable>
      {expanded ? <AttemptList attempts={request.attempts} theme={theme} /> : null}
    </View>
  );
}

function ReplyRouteRow({ item: { data }, theme }: PluginTimelineItemProps<ReplyRoute>) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation(messages);
  const muted = theme.colors.foregroundMuted;
  const history = data.requests && (data.requests.length > 1 || data.truncated || data.turnOnly) ? data.requests : undefined;
  const label = history ? t("history", { total: history.length }) : `${t("finalRoute")} · ${data.provider} · ${data.model}`;
  return (
    <View style={{ alignSelf: "flex-start", maxWidth: "100%", gap: 5 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((open) => !open)}
        style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 4 }}
      >
        <Icon icon={magpieIcon} size={14} color={muted} />
        <Text style={{ flexShrink: 1, color: muted, fontSize: 12 }}>{label}</Text>
        <Icon icon={expanded ? "ChevronUp" : "ChevronDown"} size={12} color={muted} />
      </Pressable>
      {expanded ? (
        history ? (
          <View style={{ gap: 4, paddingLeft: 19 }}>
            {history.map((request, index) => <RequestRow key={index} request={request} index={index} theme={theme} />)}
            {data.truncated ? <Text style={{ color: muted, fontSize: 12 }}>{t("truncated")}</Text> : null}
          </View>
        ) : <AttemptList attempts={data.attempts} theme={theme} />
      ) : null}
    </View>
  );
}

export function contributeReplyRoutes(client: PluginClientContext) {
  return client.addTimelineRenderer({
    kind: replyRouteKind, version: 1, schema: replyRouteSchema, Component: ReplyRouteRow,
  });
}
