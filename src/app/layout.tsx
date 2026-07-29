import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { DecisionIdentityProvider } from "@/components/decision-identity";
import { centralDecisionUiEnabled } from "@/services/decision-persistence-config";
import "./globals.css";

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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const devUiEnabled = process.env.DEV_UI_ENABLED === "true";
  const centralDecisionsEnabled = centralDecisionUiEnabled();
  return (
    <html lang="de">
      <body>
        <DecisionIdentityProvider enabled={centralDecisionsEnabled}>
          <AppShell devUiEnabled={devUiEnabled}>{children}</AppShell>
        </DecisionIdentityProvider>
      </body>
    </html>
  );
}
