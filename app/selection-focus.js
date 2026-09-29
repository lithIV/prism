// Selecting text used to blur and dim the rest of the feed; the blur is gone. The wash behind
// the picked words and the little menu are all the marking that is left. The class stays, with
// the same calls, because the selection menu holds on to it.
(() => {
'use strict';

class SelectionFocus {
 constructor() {
  this.picked = null;
 }

 show(range, box) {
  this.range = range;
  this.pick(box);
 }

 hide() {
  this.range = null;
  this.pick(null);
 }

 release() {
  this.pick(null);
 }

 // The message holding the selection keeps a slightly brighter blue wash while the menu is up.
 pick(box) {
  if (this.picked === box) return;
  this.picked?.classList.remove('select-held');
  this.picked = box;
  box?.classList.add('select-held');
 }
}

window.SelectionFocus = SelectionFocus;
})();
