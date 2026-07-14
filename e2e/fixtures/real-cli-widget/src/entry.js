// A self-contained vanilla Gridmason widget, served by the REAL `gridmason dev`
// in the optional `e2e:real-cli` verification (docs/sideload.md, issue #38).
//
// It deliberately imports NOTHING. `gridmason dev` serves a widget's entry
// source verbatim, and the scaffold template imports `@gridmason/sdk` by bare
// specifier; the dashboard's dev-sideload import scope now resolves that (issue
// #40, covered hermetically by dev-widget-server-sdk.mjs). Keeping *this* fixture
// import-free isolates the real-CLI check to the dev-server transport (manifest ->
// entry -> mount -> badge), the part this repo owns and can assert against the
// published CLI without depending on the import scope.
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
