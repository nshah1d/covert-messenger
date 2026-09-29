const SVG_NS = 'http://www.w3.org/2000/svg';

function append(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === true) continue;
    if (Array.isArray(child)) {
      append(parent, child);
    } else if (child instanceof Node) {
      parent.appendChild(child);
    } else {
      parent.appendChild(document.createTextNode(String(child)));
    }
  }
}

function apply(el, props, isSvg) {
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class' || key === 'className') {
      if (isSvg) el.setAttribute('class', value);
      else el.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      for (const [name, v] of Object.entries(value)) {
        if (v === null || v === undefined) continue;
        if (name.startsWith('--')) el.style.setProperty(name, String(v));
        else el.style[name] = typeof v === 'number' && !/^(opacity|zIndex|flex|fontWeight|lineHeight)$/.test(name) ? `${v}px` : String(v);
      }
    } else if (key === 'dataset' && typeof value === 'object') {
      Object.assign(el.dataset, value);
    } else if (key === 'ref' && typeof value === 'function') {
      value(el);
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (!isSvg && key in el && typeof value !== 'string') {
      el[key] = value;
    } else if (!isSvg && (key === 'value' || key === 'checked' || key === 'disabled' || key === 'hidden')) {
      el[key] = value;
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
}

/**
 * Creates an HTML element. Nothing is ever parsed as markup: strings and numbers
 * become text nodes, so message content cannot inject elements.
 *
 * Props: `class`; `style` as an object, where numbers become pixels except for
 * opacity, zIndex, flex, fontWeight and lineHeight, and `--` names set custom
 * properties; `dataset`; `ref`,
 * called with the element; `on*` functions as event listeners; anything else
 * as a property or attribute. null, undefined and false props and children are
 * skipped, and nested child arrays are flattened.
 *
 * @param {string} tag
 * @param {object|null} props
 * @param {...*} children
 * @returns {HTMLElement}
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  apply(el, props, false);
  append(el, children);
  return el;
}

/** Creates an SVG element with the same props and children rules as h(). */
export function s(tag, props, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  apply(el, props, true);
  append(el, children);
  return el;
}

/**
 * A 24-unit stroked SVG icon.
 * @param {Array<[string, object]>} paths Pairs of SVG tag and attributes.
 */
export function icon(size, paths, props = {}) {
  return s('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, ...props },
    paths.map(([tag, attrs]) => s(tag, attrs)));
}

export function replace(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}
