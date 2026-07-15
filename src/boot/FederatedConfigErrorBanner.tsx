/**
 * The loud surface for a malformed deployment `federated.json` (SPEC §4.4 fail-loud;
 * issue #80). A structurally invalid federated config must never be silently inert —
 * that silence is exactly what hid the missing config loader. The provider renders
 * this `role="alert"` banner above the app; the app itself still renders its local
 * widgets, so a config typo degrades to "no federation + a visible reason" rather
 * than a blank or mysteriously inert page.
 */
import './federated-config-banner.css';

/** A top-of-page alert naming the federated-config fault. */
export function FederatedConfigErrorBanner({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="gm-fedconfig-error" role="alert">
      <span className="gm-fedconfig-error__tag">Federation config error</span>
      <span className="gm-fedconfig-error__detail">{message}</span>
    </div>
  );
}
