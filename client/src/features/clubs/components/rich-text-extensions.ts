import Placeholder from '@tiptap/extension-placeholder';
import type { Extensions } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

// tiptap strips these before checking a link.
const LINK_WHITESPACE = /[\0- \xA0\u1680\u180E\u2000-\u2029\u205F\u3000]/g;
// tiptap 3.6's check, which club descriptions were written under. From 3.7 tiptap also accepts a
// scheme-less "host/path" such as facebook.com/groups/abc, which is saved as a relative link and
// so opens a page of this site, not Facebook; 3.6 refused it (a host may only be followed by the end,
// or a character other than a-z + . / 0-9 :), and so does this.
const ALLOWED_HREF = /^(?:(?:http|https|ftp|ftps|mailto|tel|callto|sms|cid|xmpp):|[^a-z]|[a-z0-9+.-]+(?:[^a-z+./0-9:]|$))/i;

/** Whether the editor may link to `href`: typed in the link prompt, auto-linked, pasted, or loaded with saved content. */
export function isAllowedLinkHref(href: string | undefined): boolean {
  return !href || ALLOWED_HREF.test(href.replace(LINK_WHITESPACE, ''));
}

/** The rich text editor's extensions. */
export function richTextExtensions(placeholder: string): Extensions {
  return [
    // StarterKit's own Link, so only one is registered; its check runs on typed, pasted and loaded links.
    StarterKit.configure({
      link: {
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-primary underline',
        },
        isAllowedUri: isAllowedLinkHref,
      },
    }),
    Placeholder.configure({
      placeholder,
    }),
  ];
}
