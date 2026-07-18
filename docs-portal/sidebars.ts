import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docs: [
    "overview",
    "architecture",
    {
      type: "category",
      label: "Protocol",
      collapsed: false,
      items: ["protocol/vault", "protocol/mini-pool", "protocol/oracle"],
    },
    "security",
    {
      type: "category",
      label: "Build",
      collapsed: false,
      items: ["sdk", "api"],
    },
    {
      type: "category",
      label: "Ecosystem integrations",
      collapsed: false,
      items: ["integrations/reflector", "integrations/blend", "integrations/aquarius"],
    },
    "addresses",
    "demo",
  ],
};

export default sidebars;
