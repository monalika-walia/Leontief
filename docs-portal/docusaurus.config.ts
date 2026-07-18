import type * as Preset from "@docusaurus/preset-classic";
import type { Config } from "@docusaurus/types";
import { themes as prismThemes } from "prism-react-renderer";

const GITHUB = "https://github.com/monalika-walia/Leontief";

const config: Config = {
  title: "Leontief",
  tagline: "The RWA utility layer on Stellar — wrap restricted assets into composable ld-shares.",
  favicon: "img/favicon.svg",

  url: "https://docs.leontief.tech",
  baseUrl: "/",

  organizationName: "monalika-walia",
  projectName: "Leontief",
  onBrokenLinks: "warn",
  onBrokenMarkdownLinks: "warn",

  markdown: { mermaid: true },
  themes: ["@docusaurus/theme-mermaid"],

  i18n: { defaultLocale: "en", locales: ["en"] },

  presets: [
    [
      "classic",
      {
        docs: {
          routeBasePath: "/", // docs at the site root
          sidebarPath: "./sidebars.ts",
          editUrl: `${GITHUB}/edit/main/docs-portal/`,
        },
        blog: false,
        theme: { customCss: "./src/css/custom.css" },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: { defaultMode: "light", respectPrefersColorScheme: true },
    docs: { sidebar: { hideable: true } },
    mermaid: { theme: { light: "neutral", dark: "dark" } },
    navbar: {
      title: "Leontief",
      logo: { alt: "Leontief", src: "img/mark.svg", srcDark: "img/mark-dark.svg" },
      items: [
        { type: "docSidebar", sidebarId: "docs", position: "left", label: "Docs" },
        { to: "/architecture", label: "Architecture", position: "left" },
        { to: "/integrations/reflector", label: "Integrations", position: "left" },
        { href: "https://app.leontief.tech", label: "Launch app", position: "right" },
        { href: GITHUB, label: "GitHub", position: "right" },
      ],
    },
    footer: {
      style: "light",
      links: [
        {
          title: "Protocol",
          items: [
            { label: "Overview", to: "/" },
            { label: "Architecture", to: "/architecture" },
            { label: "Security", to: "/security" },
            { label: "Addresses", to: "/addresses" },
          ],
        },
        {
          title: "Build",
          items: [
            { label: "SDK", to: "/sdk" },
            { label: "Indexer API", to: "/api" },
            { label: "Integrations", to: "/integrations/reflector" },
          ],
        },
        {
          title: "More",
          items: [
            { label: "Launch app", href: "https://app.leontief.tech" },
            { label: "Litepaper", href: "https://leontief.tech/litepaper" },
            { label: "GitHub", href: GITHUB },
          ],
        },
      ],
      copyright: `Leontief · a 29Projects Lab protocol · Docs CC-BY-4.0.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["rust", "toml", "bash", "json"],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
