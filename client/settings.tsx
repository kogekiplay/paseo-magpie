import { useEffect, useState } from "react";
import { defineTranslations, useRpc, useTranslation, type PluginClientContext, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { ExternalLink, SettingsAction, SettingsCard, SettingsRow, SettingsSection, TextInput } from "@getpaseo/plugin/client/ui";
import { defaultGatewayUrl, gatewayKey, gatewayUrlSetting, readGatewaySettings, saveGatewaySettings, type GatewayStatus } from "../shared/gateway-settings.ts";

const messages = defineTranslations({
  resources: {
    en: {
      connection: "Magpie gateway",
      address: "Gateway address",
      addressHint: "Use an HTTP or HTTPS address reachable from the Paseo host. Leave blank to use the host configuration or the local default.",
      key: "Gateway API key",
      keyPlaceholder: "Enter API key",
      replaceKey: "Enter a new API key",
      keyNone: "Leave blank if this gateway allows access without a key.",
      keySaved: "A key is saved on this Paseo host. Leave blank to keep it.",
      keyHost: "Using the key from the Paseo host configuration.",
      keyEnvironment: "The key is managed by PASEO_MAGPIE_API_KEY on this host.",
      keyOtherGateway: "The saved key applies to a different gateway address.",
      keyCleared: "Saving will remove the key saved here.",
      clearKey: "Remove saved key",
      undoClear: "Undo removal",
      invalidKey: "Enter a key without spaces or line breaks.",
      configuredByEnv: "PASEO_MAGPIE_URL on the daemon sets the active address.",
      loading: "Reading host settings…",
      readError: "Could not read the gateway settings.",
      retry: "Retry",
      invalidUrl: "Enter an HTTP or HTTPS URL without credentials, a query, or a fragment.",
      apply: "Apply gateway settings",
      save: "Save",
      saved: "Saved. Refresh open usage views to load the new gateway.",
      failed: "Could not save the gateway settings. Try again.",
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
      key: "网关密钥",
      keyPlaceholder: "输入网关密钥",
      replaceKey: "输入新密钥",
      keyNone: "网关允许免密访问时可留空。",
      keySaved: "密钥已保存在此 Paseo 主机。留空保留已有密钥。",
      keyHost: "正在使用 Paseo 主机配置中的密钥。",
      keyEnvironment: "密钥由主机的 PASEO_MAGPIE_API_KEY 管理。",
      keyOtherGateway: "已保存的密钥用于另一个网关地址。",
      keyCleared: "保存后会清除在此录入的密钥。",
      clearKey: "清除已保存的密钥",
      undoClear: "撤销清除",
      invalidKey: "密钥不能含空格或换行。",
      configuredByEnv: "当前地址由守护进程的 PASEO_MAGPIE_URL 指定。",
      loading: "正在读取主机设置…",
      readError: "无法读取网关设置。",
      retry: "重试",
      invalidUrl: "请填写 HTTP 或 HTTPS 地址，地址中不可包含凭据、查询参数或片段。",
      apply: "应用网关设置",
      save: "保存",
      saved: "已保存。刷新已打开的用量页即可读取新网关。",
      failed: "无法保存网关设置，请重试。",
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

const keyHints = { none: "keyNone", saved: "keySaved", host: "keyHost", environment: "keyEnvironment" } as const;

function GatewaySettings({ theme, layout }: Pick<PluginSurfaceProps, "theme" | "layout">) {
  const { t } = useTranslation(messages);
  const read = useRpc(readGatewaySettings);
  const save = useRpc(saveGatewaySettings);
  const [settings, setSettings] = useState<GatewayStatus | "error">();
  const [attempt, setAttempt] = useState(0);
  const [address, setAddress] = useState<string>();
  const [key, setKey] = useState("");
  const [clear, setClear] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<"saved" | "failed" | "invalidUrl" | "invalidKey" | "changed" | "keyEnvironment">();

  useEffect(() => {
    let current = true;
    void read({}).then((value) => {
      if (current) setSettings(value);
    }, () => {
      if (current) setSettings("error");
    });
    return () => { current = false; };
  }, [read, attempt]);

  function resetDraft() {
    setAddress(undefined);
    setKey("");
    setClear(false);
  }

  function reload() {
    resetDraft();
    setFeedback(undefined);
    setSettings(undefined);
    setAttempt((value) => value + 1);
  }

  let rows;
  if (settings === "error") {
    rows = <SettingsAction label={t("address")} hint={t("readError")} actionLabel={t("retry")} onPress={reload} />;
  } else if (!settings) {
    rows = <SettingsRow label={t("address")} hint={t("loading")} />;
  } else {
    const text = address ?? settings.url;
    const addressChanged = text.trim() !== settings.url;
    const keyLocked = settings.keySource === "environment" && !addressChanged;
    const keyHint = clear ? "keyCleared"
      : (addressChanged || settings.keySource === "none") && settings.hasSavedKey ? "keyOtherGateway"
      : addressChanged ? "keyNone" : keyHints[settings.keySource];
    const inputStyle = {
      width: layout.compact ? 250 : 320, maxWidth: "100%" as const, minHeight: 36, paddingHorizontal: 10,
      color: theme.colors.foreground, backgroundColor: theme.colors.surface1,
      borderColor: theme.colors.border, borderWidth: 1, borderRadius: 8, fontSize: 14,
    };
    const apply = async () => {
      if (saving) return;
      const url = gatewayUrlSetting.safeParse(text);
      if (!url.success) { setFeedback("invalidUrl"); return; }
      const secret = key.trim() ? gatewayKey.safeParse(key) : undefined;
      if (secret && !secret.success) { setFeedback("invalidKey"); return; }
      setSaving(true);
      setFeedback(undefined);
      try {
        const result = await save({ url: url.data, revision: settings.revision, apiKey: clear ? null : secret?.data });
        if (result.status === "saved") {
          setSettings(result.settings);
          resetDraft();
          setFeedback("saved");
        } else {
          setFeedback(result.status === "managed" ? "keyEnvironment" : "changed");
        }
      } catch {
        setFeedback("failed");
      } finally {
        setSaving(false);
      }
    };
    rows = [
      <SettingsRow key="address" testID="magpie-gateway-url"
        label={t("address")} hint={t(settings.environmentOverride ? "configuredByEnv" : "addressHint")}
        error={feedback === "invalidUrl" ? t(feedback) : undefined}>
        <TextInput accessibilityLabel={t("address")} value={text}
          editable={!settings.environmentOverride && !saving} placeholder={defaultGatewayUrl}
          placeholderTextColor={theme.colors.foregroundMuted} autoCapitalize="none" autoCorrect={false}
          keyboardType="url" maxLength={2048} style={inputStyle}
          onChangeText={(value) => { setAddress(value); setFeedback(undefined); }} />
      </SettingsRow>,
      <SettingsRow key="key" testID="magpie-gateway-key" label={t("key")} hint={t(keyHint)}
        error={feedback === "invalidKey" || feedback === "keyEnvironment" ? t(feedback) : undefined}>
        <TextInput accessibilityLabel={t("key")} value={key} secureTextEntry autoComplete="off"
          editable={!keyLocked && !saving} placeholder={t(settings.keySource === "saved" && !addressChanged ? "replaceKey" : "keyPlaceholder")}
          placeholderTextColor={theme.colors.foregroundMuted} autoCapitalize="none" autoCorrect={false}
          maxLength={4096} style={inputStyle} onChangeText={(value) => { setKey(value); setClear(false); setFeedback(undefined); }} />
      </SettingsRow>,
      settings.hasSavedKey && !key.trim() ? (
        <SettingsAction key="clear" testID="magpie-gateway-clear" label={t("key")} actionLabel={t(clear ? "undoClear" : "clearKey")}
          disabled={saving} onPress={() => { setClear(!clear); setFeedback(undefined); }} />
      ) : null,
      feedback === "changed" ? (
        <SettingsAction key="action" label={t("apply")} hint={t("changed")} actionLabel={t("loadCurrent")} onPress={reload} />
      ) : (
        <SettingsAction key="action" testID="magpie-gateway-save" label={t("apply")} hint={feedback === "saved" ? t(feedback) : undefined}
          error={feedback === "failed" ? t(feedback) : undefined} actionLabel={t("save")}
          disabled={saving || !(addressChanged || key.trim() || clear)} onPress={() => { void apply(); }} />
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
