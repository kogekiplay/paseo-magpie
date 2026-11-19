import { defineTranslations, useTranslation, type PluginClientContext } from "@getpaseo/plugin/client";
import { ExternalLink, SettingsCard, SettingsRow, SettingsSection } from "@getpaseo/plugin/client/ui";

const messages = defineTranslations({
  resources: {
    en: {
      section: "Codex reply routing",
      dependency: "Magpie Paseo Bridge",
      hint: "Install version 0.1.2 or newer on the same Mac or Linux computer as the Paseo daemon to see each recorded Codex request's route.",
      guide: "Plugin installation guide",
      guideUrl: "https://github.com/kogekiplay/magpie-paseo-bridge#installation",
    },
    "zh-CN": {
      section: "Codex 回复路由",
      dependency: "Magpie Paseo Bridge",
      hint: "在与 Paseo 守护进程同机运行的 Magpie 中安装 0.1.2 或更新版本，即可逐次查看 Codex 已记录请求的实际路由。支持 macOS 和 Linux。",
      guide: "插件安装指南",
      guideUrl: "https://github.com/kogekiplay/magpie-paseo-bridge/blob/main/README.zh-CN.md#安装",
    },
  },
});

function MagpieSettings() {
  const { t } = useTranslation(messages);
  return (
    <SettingsSection title={t("section")}>
      <SettingsCard>
        <SettingsRow label={t("dependency")} hint={t("hint")}>
          <ExternalLink href={t("guideUrl")}>{t("guide")}</ExternalLink>
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}

export function contributeSettings(client: PluginClientContext) {
  return client.addSettingsScreen({
    id: "reply-routing", title: messages.message("section"), icon: "Route", Component: MagpieSettings,
  });
}
