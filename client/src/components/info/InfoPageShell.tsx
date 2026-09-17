import type { PropsWithChildren, ReactNode } from 'react';
import { buildStaticInfoPageSeo, type StaticInfoPage } from '@2play/shared';
import { usePageSeo } from '../../seo/usePageSeo';

/**
 * Shared frame for the public information/legal pages: applies the page's
 * SEO head (title, description, canonical, OG, Twitter) and renders the
 * visible lead paragraph with the exact same text as the meta description,
 * so head and page can never drift apart.
 */
export function InfoPageShell({
  page,
  children,
  lead,
}: PropsWithChildren<{ page: StaticInfoPage; lead?: ReactNode }>) {
  usePageSeo(buildStaticInfoPageSeo(page));
  return (
    <article className="space-y-6 pb-4">
      <header className="space-y-3">
        <h1 className="text-2xl font-black text-white sm:text-3xl">{page.title}</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-slate-300 sm:text-base">
          {lead ?? page.description}
        </p>
      </header>
      {children}
    </article>
  );
}

/** Card section matching the platform's mobile-first surface styling. */
export function InfoSection({
  title,
  children,
}: PropsWithChildren<{ title: string }>) {
  return (
    <section className="space-y-3 rounded-3xl border border-white/10 bg-surface/60 p-6 sm:p-8">
      <h2 className="text-lg font-bold text-white">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-slate-300">{children}</div>
    </section>
  );
}
