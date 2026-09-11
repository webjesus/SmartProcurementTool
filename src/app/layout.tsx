import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { DecisionIdentityProvider } from "@/components/decision-identity";
import { centralDecisionUiEnabled } from "@/services/decision-persistence-config";
import { isBrowserLocal } from "@/services/deployment-profile";
import { THEME_BOOTSTRAP_SCRIPT } from "@/ui/theme";
import "@fontsource-variable/inter";
import "./globals.css";
import "./quiet-shell.css";
import "./lv-workspace-v2.css";

export const metadata: Metadata = {
  title: {
    default: "Smart Procurement Tool",
    template: "%s | SPT"
  },
  description: "Evidence-first procurement analysis, validation and operator review.",
  robots: {
    index: false,
    follow: false
  }
};

// Deployment and identity modes are runtime configuration on the local server.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const devUiEnabled = process.env.DEV_UI_ENABLED === "true";
  const centralDecisionsEnabled = centralDecisionUiEnabled();
  const browserLocal = isBrowserLocal();
  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body>
        <DecisionIdentityProvider enabled={centralDecisionsEnabled}>
          <AppShell devUiEnabled={devUiEnabled} browserLocal={browserLocal}>
            {children}
          </AppShell>
        </DecisionIdentityProvider>
      </body>
    </html>
  );
}
