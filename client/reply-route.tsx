import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { PluginClientContext, PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { replyRouteKind, replyRouteSchema, type ReplyRoute } from "../shared/reply-route.ts";
import { magpieIcon } from "../shared/icon.ts";

function ReplyRouteRow({ item: { data }, theme }: PluginTimelineItemProps<ReplyRoute>) {
  const [expanded, setExpanded] = useState(false);
  const muted = theme.colors.foregroundMuted;
  return (
    <View style={{ alignSelf: "flex-start", maxWidth: "100%", gap: 5 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`实际路由，${data.provider}，${data.model}`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((open) => !open)}
        style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 4 }}
      >
        <Icon icon={magpieIcon} size={14} color={muted} />
        <Text style={{ flexShrink: 1, color: muted, fontSize: 12 }}>{data.provider} · {data.model}</Text>
        <Icon icon={expanded ? "ChevronUp" : "ChevronDown"} size={12} color={muted} />
      </Pressable>
      {expanded ? (
        <View style={{ gap: 4, paddingLeft: 19 }}>
          <Text style={{ color: muted, fontSize: 12 }}>尝试记录</Text>
          {data.attempts.map((attempt, index) => (
            <Text key={index} selectable style={{ color: theme.colors.foreground, fontSize: 12 }}>
              {index + 1}. {attempt.route} · {attempt.failed ? "失败" : "完成"}
              {attempt.status === undefined ? "" : ` · HTTP ${attempt.status}`}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function contributeReplyRoutes(client: PluginClientContext) {
  return client.addTimelineRenderer({
    kind: replyRouteKind, version: 1, schema: replyRouteSchema, Component: ReplyRouteRow,
  });
}
