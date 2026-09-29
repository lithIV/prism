(() => {
'use strict';

const GLYPH = '<svg class="icon" viewBox="30 30 60 60" fill="none" stroke="currentColor" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g class="glyph"><rect x="33" y="38" width="17" height="44" rx="5"/><rect x="57" y="38" width="17" height="44" rx="5"/></g></svg>';

class ParallelButton extends IconButton {
 constructor() {
  super(GLYPH, {}, ':host{width:auto}');
 }
 defaultLabel() {
  return I18n.t('parallel.title');
 }
 activate() {
  this.dispatchEvent(new CustomEvent('parallel-toggle', { bubbles: true, composed: true }));
 }
}

if (!customElements.get('parallel-button')) customElements.define('parallel-button', ParallelButton);
})();
