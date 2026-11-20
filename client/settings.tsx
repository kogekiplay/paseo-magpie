import { useEffect, useState } from "react";
import { defineTranslations, useRpc, useSettings, useTranslation, type PluginClientContext, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { ExternalLink, SettingsAction, SettingsCard, SettingsRow, SettingsSection, TextInput } from "@getpaseo/plugin/client/ui";
import { defaultGatewayUrl, gatewaySettings, gatewayUrlSetting, getGatewaySettingsStatus } from "../shared/gateway-settings.ts";

const messages = defineTranslations({
  resources: {
    en: {
      connection: "Magpie gateway",
      address: "Gateway address",
      addressHint: "Use an HTTP or HTTPS address reachable from the Paseo host. Leave blank to use the host configuration or the local default.",
      credentialsHint: "For a gateway that requires a key, configure both url and apiKey in the daemon's config.json. Keys stay on the host.",
      configuredByEnv: "PASEO_MAGPIE_URL on the daemon sets the active address.",
      loading: "Reading host settings…",
      readError: "Could not read the gateway settings.",
      retry: "Retry",
      invalidStored: "The saved address is invalid. You can restore the host default.",
      reset: "Restore default",
      invalidUrl: "Enter an HTTP or HTTPS URL without credentials, a query, or a fragment.",
      apply: "Apply gateway address",
      save: "Save",
      saved: "Saved. Refresh open usage views to load the new gateway.",
      failed: "Could not save the address. Try again.",
      changed: "Another client changed these settings. Load the current value before editing again.",
      loadCurrent: "Load current value",
      section: "Codex reply routing",
      dependency: "Magpie Paseo Bridge",
      hint: "Install version 0.1.2 or newer on the same Mac or Linux computer as the Paseo daemon to see each recorded Codex request's route.",
      guide: "Plugin installation guide",
      guideUrl: "https://github.com/kogekiplay/magpie-paseo-bridge#installation",
    },
    "zh-CN": {
      connection: "Magpie 网关",
      address: "网关地址",
      addressHint: "填写 Paseo 主机可访问的 HTTP 或 HTTPS 地址。留空使用主机配置，未配置时连接本机网关。",
      credentialsHint: "需要密钥的网关，请在守护进程的 config.json 中同时填写 url 和 apiKey。密钥保存在主机上。",
      configuredByEnv: "当前地址由守护进程的 PASEO_MAGPIE_URL 指定。",
      loading: "正在读取主机设置…",
      readError: "无法读取网关设置。",
      retry: "重试",
      invalidStored: "保存的地址无效，可以恢复主机默认值。",
      reset: "恢复默认",
      invalidUrl: "请填写 HTTP 或 HTTPS 地址，地址中不可包含凭据、查询参数或片段。",
      apply: "应用网关地址",
      save: "保存",
      saved: "已保存。刷新已打开的用量页即可读取新网关。",
      failed: "无法保存地址，请重试。",
      changed: "其他客户端已修改设置。请先载入当前值，再重新编辑。",
      loadCurrent: "载入当前值",
      section: "Codex 回复路由",
      dependency: "Magpie Paseo Bridge",
      hint: "在与 Paseo 守护进程同机运行的 Magpie 中安装 0.1.2 或更新版本，即可逐次查看 Codex 已记录请求的实际路由。支持 macOS 和 Linux。",
      guide: "插件安装指南",
      guideUrl: "https://github.com/kogekiplay/magpie-paseo-bridge/blob/main/README.zh-CN.md#安装",
    },
  },
});

function GatewaySettings({ theme, layout }: Pick<PluginSurfaceProps, "theme" | "layout">) {
  const { t } = useTranslation(messages);
  const settings = useSettings(gatewaySettings);
  const status = useRpc(getGatewaySettingsStatus);
  const [override, setOverride] = useState<boolean | "error">();
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<{ text: string; revision: string }>();
  const [feedback, setFeedback] = useState<"saved" | "failed" | "invalidUrl">();

  useEffect(() => {
    let current = true;
    void status({}).then(({ environmentOverride }) => {
      if (current) setOverride(environmentOverride);
    }, () => {
      if (current) setOverride("error");
    });
    return () => { current = false; };
  }, [status, attempt]);

  let rows;
  if (override === "error" || settings.status === "error") {
    rows = <SettingsAction label={t("address")} hint={t("readError")} actionLabel={t("retry")} onPress={() => {
      setOverride(undefined);
      setAttempt((value) => value + 1);
      void settings.reload();
    }} />;
  } else if (override === undefined || settings.status === "loading") {
    rows = <SettingsRow label={t("address")} hint={t("loading")} />;
  } else if (settings.status === "invalid") {
    rows = <SettingsAction label={t("address")} hint={t("invalidStored")} actionLabel={t("reset")}
      error={settings.saveError ? t("failed") : undefined} disabled={settings.saving} onPress={() => { void settings.reset(); }} />;
  } else {
    const changed = draft !== undefined && draft.revision !== settings.revision;
    const save = async () => {
      if (!draft || changed || override) return;
      const url = gatewayUrlSetting.safeParse(draft.text);
      if (!url.success) { setFeedback("invalidUrl"); return; }
      const ok = await settings.save({ url: url.data }, draft.revision);
      if (ok) setDraft(undefined);
      setFeedback(ok ? "saved" : "failed");
    };
    rows = [
      <SettingsRow key="address" testID="magpie-gateway-url"
        label={t("address")} hint={t(override ? "configuredByEnv" : "addressHint")}
        error={feedback === "invalidUrl" ? t(feedback) : undefined}>
        <TextInput accessibilityLabel={t("address")} value={draft?.text ?? settings.values.url}
          editable={!override && !settings.saving} placeholder={defaultGatewayUrl}
          placeholderTextColor={theme.colors.foregroundMuted} autoCapitalize="none" autoCorrect={false}
          keyboardType="url" maxLength={2048}
          style={{
            width: layout.compact ? 250 : 320, maxWidth: "100%", minHeight: 36, paddingHorizontal: 10,
            color: theme.colors.foreground, backgroundColor: theme.colors.surface1,
            borderColor: theme.colors.border, borderWidth: 1, borderRadius: 8, fontSize: 14,
          }}
          onChangeText={(text) => {
            setDraft((previous) => ({ text, revision: previous?.revision ?? settings.revision }));
            setFeedback(undefined);
          }} />
      </SettingsRow>,
      override ? null : changed ? (
        <SettingsAction key="action" label={t("apply")} hint={t("changed")} actionLabel={t("loadCurrent")}
          onPress={() => { setDraft(undefined); setFeedback(undefined); }} />
      ) : (
        <SettingsAction key="action" testID="magpie-gateway-save" label={t("apply")} hint={feedback === "saved" ? t(feedback) : t("credentialsHint")}
          error={feedback === "failed" ? t(feedback) : undefined} actionLabel={t("save")}
          disabled={!draft || draft.text.trim() === settings.values.url || settings.saving}
          onPress={() => { void save(); }} />
      ),
    ];
  }

  return <SettingsSection title={t("connection")}><SettingsCard>{rows}</SettingsCard></SettingsSection>;
}

function MagpieSettings({ host, theme, layout }: PluginSurfaceProps) {
  const { t } = useTranslation(messages);
  return (
    <>
      <GatewaySettings key={host.id} theme={theme} layout={layout} />
      <SettingsSection title={t("section")}>
        <SettingsCard>
          <SettingsRow label={t("dependency")} hint={t("hint")}>
            <ExternalLink href={t("guideUrl")}>{t("guide")}</ExternalLink>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </>
  );
}

export function contributeSettings(client: PluginClientContext) {
  return client.addSettingsScreen({
    id: "reply-routing", title: messages.message("connection"), icon: "Settings", Component: MagpieSettings,
  });
}
