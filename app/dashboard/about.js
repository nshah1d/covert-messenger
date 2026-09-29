import { h } from '../lib/dom.js';

/** Credit and links shown in the About card at the end of the overview. */
export const ABOUT = Object.freeze({
  credit: 'Made by Nauman Shahid.',
  links: Object.freeze([
    Object.freeze({ label: 'nauman.cc', href: 'https://www.nauman.cc' }),
    Object.freeze({ label: 'GitHub', href: 'https://github.com/nshah1d' }),
    Object.freeze({ label: 'LinkedIn', href: 'https://www.linkedin.com/in/nshah1d/' }),
    Object.freeze({ label: 'Support on Ko-fi', href: 'https://ko-fi.com/nshah1d' })
  ])
});

/** The About card. Links open in a new tab without sending a referrer. */
export function aboutSection() {
  return h('section', { class: 'f1-about', 'aria-labelledby': 'f1-about-heading' },
    h('h2', { id: 'f1-about-heading', class: 'f1-overview-kicker' }, 'About'),
    h('p', { class: 'f1-about-credit' }, ABOUT.credit),
    h('div', { class: 'f1-about-links' }, ABOUT.links.map((link, index) => h('a', {
      href: link.href,
      target: '_blank',
      rel: 'noopener noreferrer',
      class: index === ABOUT.links.length - 1 ? 'f1-about-link support' : 'f1-about-link'
    }, link.label))));
}
