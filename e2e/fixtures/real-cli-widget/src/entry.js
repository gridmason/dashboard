// A self-contained vanilla Gridmason widget, served by the REAL `gridmason dev`
// in the optional `e2e:real-cli` verification (docs/sideload.md, issue #38).
//
// It deliberately imports NOTHING. `gridmason dev` serves a widget's entry
// source verbatim, and the scaffold template imports `@gridmason/sdk` by bare
// specifier — which the dashboard cannot resolve today (it provides no shared
// `@gridmason/*` import scope for a sideloaded module; see docs/sideload.md).
// Keeping this fixture import-free isolates the check to the dev-server transport
// (manifest -> entry -> mount -> badge), the part this repo owns and can assert.
const BUILD = 'v1';

class SelfNote extends HTMLElement {
  connectedCallback() {
    this.setAttribute('data-testid', 'self-note');
    this.style.display = 'block';
    this.style.padding = '10px';
    this.textContent = 'Self Note ' + BUILD;
  }
}

if (!customElements.get('demo-selfnote')) {
  customElements.define('demo-selfnote', SelfNote);
}

export default SelfNote;
