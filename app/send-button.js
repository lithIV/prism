(() => {
'use strict';

const HOVER_LIFT = 6;

// One button, three jobs: the arrow sends, turns into a redirect arrow to steer a running
// reply with what you typed, and becomes a stop square while the composer is empty.
class SendButton extends IconButton {
 constructor(){
  super(`
   <svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="30 30 60 60" fill="none" aria-hidden="true">
    <g class="glyph">
     <g class="arrow" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M60 84V37"/>
      <path d="M41 56 60 37 79 56"/>
     </g>
     <g class="turn" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" style="display:none">
      <path d="M45 80V59a10 10 0 0 1 10-10h13"/>
      <path d="M61 40l9 9-9 9"/>
     </g>
     <g class="stop" style="display:none">
      <rect x="43" y="43" width="34" height="34" rx="9" fill="currentColor"/>
     </g>
    </g>
   </svg>`,{lift:[230,27]},`
   button{border-radius:50%;background:rgb(var(--send-bg,250,250,250))}
   button:focus-visible::after{inset:-4px}`);
  this.arrow=this.shadowRoot.querySelector('.arrow');
  this.turn=this.shadowRoot.querySelector('.turn');
  this.stop=this.shadowRoot.querySelector('.stop');
  this.syncMode();
 }
 static get observedAttributes(){return [...IconButton.observedAttributes,'mode']}
 attributeChangedCallback(){
  super.attributeChangedCallback();
  this.syncMode();
 }
 get mode(){return this.getAttribute('mode')||'send'}
 set mode(value){this.setAttribute('mode',value==='stop'?'stop':value==='steer'?'steer':'send')}
 syncMode(){
  if(!this.arrow)return;
  const mode=this.mode;
  this.arrow.style.display=mode==='send'?'':'none';
  this.turn.style.display=mode==='steer'?'':'none';
  this.stop.style.display=mode==='stop'?'':'none';
  const label=this.getAttribute('label')||this.defaultLabel();
  this.button.setAttribute('aria-label',label);
  this.button.title=label;
  this.wake();
 }
 defaultLabel(){return I18n.t(this.mode==='stop'?'button.stop':this.mode==='steer'?'button.steer':'button.send')}
 activate(){
  this.dispatchEvent(new CustomEvent(this.mode==='stop'?'composer-stop':'composer-send',{bubbles:true,composed:true}));
 }
 targets(hover,reduced){return {lift:reduced?0:hover}}
 render(v){
  const lift=`translate(0 ${-v.lift*HOVER_LIFT})`;
  this.arrow.setAttribute('transform',lift);
  this.turn.setAttribute('transform',lift);
  this.stop.setAttribute('transform',lift);
  this.button.style.transform=`scale(${1-v.press*.06})`;
 }
}
if(!customElements.get('send-button'))customElements.define('send-button',SendButton);
})();
