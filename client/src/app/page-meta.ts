import { useEffect } from "react";

export const SITE_NAME = "LovePoker.club";

interface PageMeta {
  /** The page's own title; the tab reads "<title> | LovePoker.club". */
  title?: string;
  /** Keeps search engines from indexing a page that names players (their names, photos, results). */
  noindex?: boolean;
}

/** Sets the document title and robots meta while the page is shown, and puts the previous ones back. */
export function usePageMeta({ title, noindex = false }: PageMeta): void {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title} | ${SITE_NAME}`;
    return () => {
      document.title = previous;
    };
  }, [title]);

  useEffect(() => {
    if (!noindex) return;
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, [noindex]);
}
