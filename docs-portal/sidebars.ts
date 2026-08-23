import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docs: [
    "overview",
    "reviewers",
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
      items: ["sdk", "api", "agent-treasury"],
    },
    {
      type: "category",
      label: "Ecosystem integrations",
      collapsed: false,
      items: ["integrations/reflector", "integrations/blend", "integrations/aquarius"],
    },
    {
      type: "category",
      label: "Access & automation",
      collapsed: false,
      items: ["telegram", "autopilot"],
    },
    "metrics-methodology",
    "addresses",
    "demo",
    "team",
  ],
};

export default sidebars;
