const BRAND = 'Acme Crosswalk Safety';
const PROMO_CODE = 'ACMEDEMO10';

export function textToHtml(text) {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const linked = escaped.replace(
    new RegExp(`(Explore ${BRAND}: )?(https?:\\/\\/[^\\s<]*[^\\s<.,;:!?)])`, 'g'),
    (m, label, url) => label
      ? `<a href="${url}">Explore ${BRAND}</a>`
      : `<a href="${url}">${url}</a>`
  );
  const promoRe = new RegExp(`10% off[^.\\n]*${PROMO_CODE}(?: at checkout)?`);
  const bolded = promoRe.test(linked)
    ? linked.replace(promoRe, m => `<strong>${m}</strong>`)
    : linked.replace(PROMO_CODE, m => `<strong>${m}</strong>`);
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;">${bolded.replace(/\n/g, '<br>')}</div>`;
}
