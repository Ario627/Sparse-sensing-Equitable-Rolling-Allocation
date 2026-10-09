import { domAnimation, LazyMotion, MotionConfig } from "motion/react";
import { BrandMark } from "@/components/shell/brand.tsx";
import { LinkButton } from "@/components/shell/link-button.tsx";
import { LandingHero } from "@/features/landing/landing-hero.tsx";
import { LandingFooter, LandingSections } from "@/features/landing/landing-sections.tsx";
import { useSessionStore } from "@/lib/auth/session-store.ts";

export function LandingPage() {
  const authed = useSessionStore((snapshot) => snapshot.user !== null);
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <div className="flex min-h-dvh flex-col bg-paper">
          <header className="sticky top-0 z-20 border-b border-line bg-paper pt-safe">
            <div className="mx-auto flex max-w-shell items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-10">
              <BrandMark />
              <LinkButton
                to={authed ? "/operations" : "/login"}
                variant={authed ? "primary" : "outline"}
                size="sm"
              >
                {authed ? "Buka Operasi" : "Masuk"}
              </LinkButton>
            </div>
          </header>
          <main className="flex-1">
            <LandingHero authed={authed} />
            <LandingSections />
          </main>
          <LandingFooter authed={authed} />
        </div>
      </MotionConfig>
    </LazyMotion>
  );
}
